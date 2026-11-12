from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import create_engine, text
import pandas as pd
import io
import jwt
from datetime import datetime, timedelta
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

DATABASE_URL = "postgresql+psycopg://postgres:Kantati@localhost:5432/control_presupuestario"
engine = create_engine(DATABASE_URL)
SECRET_KEY = "hackathon_exb_secreto"
TASA_USD = 6.96

app = FastAPI(title="API Control Presupuestario EXB")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://presupuestito-exb.vercel.app",
    ],
    allow_origin_regex=r"https://presupuestito-.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MESES_MAP = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4,
    "MAYO": 5, "JUNIO": 6, "JULIO": 7, "AGOSTO": 8,
    "SEPTIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11, "DICIEMBRE": 12
}

def verificar_admin(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Solo administradores pueden modificar datos")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        if payload.get("rol") != "admin":
            raise HTTPException(status_code=403, detail="Permisos insuficientes")
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")

@app.post("/api/login")
def login(datos: dict):
    with engine.connect() as conn:
        user = conn.execute(
            text("SELECT id, nombre, email, rol FROM usuarios WHERE email = :e AND password_hash = :p AND activo = TRUE"),
            {"e": datos.get("email"), "p": datos.get("password")}
        ).mappings().first()
        if not user:
            raise HTTPException(status_code=401, detail="Credenciales incorrectas")
        token = jwt.encode(
            {"id": user["id"], "rol": user["rol"], "exp": datetime.utcnow() + timedelta(hours=12)},
            SECRET_KEY,
            algorithm="HS256"
        )
        return {"token": token, "nombre": user["nombre"], "rol": user["rol"]}

def obtener_o_crear(conn, tabla, nombre, extra_col=None, extra_val=None):
    nombre = str(nombre).strip() if pd.notna(nombre) and str(nombre).strip() != "" else "SIN ESPECIFICAR"
    if extra_col:
        row = conn.execute(
            text(f"SELECT id FROM {tabla} WHERE nombre = :n AND {extra_col} = :v"),
            {"n": nombre, "v": extra_val}
        ).fetchone()
        if row:
            return row[0]
        res = conn.execute(
            text(f"INSERT INTO {tabla} (nombre, {extra_col}) VALUES (:n, :v) RETURNING id"),
            {"n": nombre, "v": extra_val}
        ).fetchone()
        return res[0]
    else:
        row = conn.execute(text(f"SELECT id FROM {tabla} WHERE nombre = :n"), {"n": nombre}).fetchone()
        if row:
            return row[0]
        res = conn.execute(text(f"INSERT INTO {tabla} (nombre) VALUES (:n) RETURNING id"), {"n": nombre}).fetchone()
        return res[0]

@app.post("/api/importar")
async def importar_excel(archivo: UploadFile = File(...), admin: dict = Depends(verificar_admin)):
    contenido = await archivo.read()
    df = pd.read_excel(io.BytesIO(contenido), sheet_name="BD", header=1)
    df = df.dropna(subset=["mes"])

    with engine.begin() as conn:
        imp = conn.execute(
            text("INSERT INTO importaciones (usuario_id, nombre_archivo, gestion, filas_procesadas) VALUES (:u, :f, 2026, :n) RETURNING id"),
            {"u": admin["id"], "f": archivo.filename, "n": len(df)}
        ).fetchone()
        imp_id = imp[0]

        for _, r in df.iterrows():
            fin_id = obtener_o_crear(conn, "financiadores", r.get("fondo"))
            reg_id = obtener_o_crear(conn, "regiones", r.get("region"))
            area_id = obtener_o_crear(conn, "areas", r.get("area"))
            rubro_id = obtener_o_crear(conn, "rubros", r.get("rubro"))
            cuenta_id = obtener_o_crear(conn, "cuentas", r.get("Cuenta"), "rubro_id", rubro_id)

            mes_str = str(r.get("mes")).strip().upper()
            ptto = float(r["presupuesto Bs"]) if pd.notna(r.get("presupuesto Bs")) else 0.0
            ejec = float(r["Ejecución"]) if pd.notna(r.get("Ejecución")) else 0.0

            fecha_val = pd.to_datetime(r.get("cfecha"), dayfirst=True, errors="coerce")
            gestion_val = int(fecha_val.year) if pd.notna(fecha_val) else 2026
            fecha_sql = fecha_val.date() if pd.notna(fecha_val) else datetime(gestion_val, 1, 1).date()

            if ptto != 0:
                conn.execute(
                    text("""INSERT INTO presupuestos (gestion, financiador_id, region_id, area_id, cuenta_id, monto_inicial)
                            VALUES (:g, :f, :r, :a, :c, :m)"""),
                    {"g": gestion_val, "f": fin_id, "r": reg_id, "a": area_id, "c": cuenta_id, "m": ptto}
                )

            if mes_str != "PTTO" and ejec != 0:
                mes_num = MESES_MAP.get(mes_str, fecha_sql.month)
                conn.execute(
                    text("""INSERT INTO movimientos (importacion_id, gestion, fecha, mes, financiador_id, region_id, area_id, rubro_id, cuenta_id, monto, glosa)
                            VALUES (:imp, :g, :fec, :mes, :f, :r, :a, :rub, :c, :m, :glosa)"""),
                    {
                        "imp": imp_id, "g": gestion_val, "fec": fecha_sql, "mes": mes_num,
                        "f": fin_id, "r": reg_id, "a": area_id, "rub": rubro_id, "c": cuenta_id,
                        "m": ejec, "glosa": str(r.get("ref", ""))
                    }
                )

    return {"importados": len(df)}

@app.delete("/api/importar")
def vaciar_base(admin: dict = Depends(verificar_admin)):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE movimientos, presupuestos, modificaciones, importaciones RESTART IDENTITY CASCADE"))
    return {"ok": True}

@app.get("/api/auditoria")
def listar_importaciones():
    sql = """
        SELECT i.id, i.nombre_archivo, i.gestion, i.filas_procesadas, i.estado,
               TO_CHAR(i.fecha_importacion, 'DD/MM/YYYY HH24:MI') AS fecha,
               COALESCE(u.nombre, 'Administrador') AS usuario
        FROM importaciones i
        LEFT JOIN usuarios u ON i.usuario_id = u.id
        ORDER BY i.fecha_importacion DESC
        LIMIT 20
    """
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]

@app.get("/api/detalle")
def detalle_fila(
    rubro: str = None, cuenta: str = None, financiador: str = None,
    area: str = None, region: str = None, mes: int = None, gestion: int = None,
    moneda: str = "BOB"
):
    factor = (1.0 / TASA_USD) if moneda == "USD" else 1.0
    conds, params = [], {"factor": factor}
    if rubro:
        conds.append("ru.nombre = :rubro")
        params["rubro"] = rubro
    if cuenta:
        conds.append("cu.nombre = :cuenta")
        params["cuenta"] = cuenta
    if financiador:
        conds.append("fi.nombre = :financiador")
        params["financiador"] = financiador
    if area:
        conds.append("ar.nombre = :area")
        params["area"] = area
    if region:
        conds.append("re.nombre = :region")
        params["region"] = region
    if mes:
        conds.append("m.mes = :mes")
        params["mes"] = int(mes)
    if gestion:
        conds.append("m.gestion = :gestion")
        params["gestion"] = int(gestion)

    where_sql = ("WHERE " + " AND ".join(conds)) if conds else ""
    sql = f"""
        SELECT m.fecha::text AS fecha, fi.nombre AS financiador, re.nombre AS region,
               ar.nombre AS area, cu.nombre AS cuenta, m.glosa,
               ROUND((m.monto * :factor)::numeric, 2) AS monto
        FROM movimientos m
        LEFT JOIN financiadores fi ON m.financiador_id = fi.id
        LEFT JOIN regiones re ON m.region_id = re.id
        LEFT JOIN areas ar ON m.area_id = ar.id
        LEFT JOIN rubros ru ON m.rubro_id = ru.id
        LEFT JOIN cuentas cu ON m.cuenta_id = cu.id
        {where_sql}
        ORDER BY m.fecha DESC
        LIMIT 100
    """
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]

@app.get("/api/reportes")
def generar_reporte(
    agrupar: str = "rubro", gestion: str = None, financiador: str = None,
    region: str = None, area: str = None, moneda: str = "BOB"
):
    factor = (1.0 / TASA_USD) if moneda == "USD" else 1.0
    campos_map = {
        "rubro": "ru.nombre AS rubro",
        "cuenta": "cu.nombre AS cuenta",
        "financiador": "fi.nombre AS financiador",
        "area": "ar.nombre AS area",
        "region": "re.nombre AS region",
        "mes": "m.mes AS mes",
        "gestion": "u.gestion AS gestion",
        "fecha": "m.fecha::text AS fecha",
        "glosa": "m.glosa AS glosa"
    }
    cols_req = [c.strip() for c in agrupar.split(",") if c.strip() in campos_map]
    select_cols = ", ".join([campos_map[c] for c in cols_req])
    group_cols = ", ".join([campos_map[c].split(" AS ")[0] for c in cols_req])

    filtros_p, filtros_m, params = [], [], {"factor": factor}
    if gestion:
        filtros_p.append("p.gestion = :gestion")
        filtros_m.append("m.gestion = :gestion")
        params["gestion"] = int(gestion)
    if financiador:
        filtros_p.append("fi.nombre ILIKE :financiador")
        filtros_m.append("fi.nombre ILIKE :financiador")
        params["financiador"] = f"%{financiador}%"
    if region:
        filtros_p.append("re.nombre ILIKE :region")
        filtros_m.append("re.nombre ILIKE :region")
        params["region"] = f"%{region}%"
    if area:
        filtros_p.append("ar.nombre ILIKE :area")
        filtros_m.append("ar.nombre ILIKE :area")
        params["area"] = f"%{area}%"

    where_p = ("WHERE " + " AND ".join(filtros_p)) if filtros_p else ""
    where_m = ("WHERE " + " AND ".join(filtros_m)) if filtros_m else ""

    if "fecha" in cols_req or "glosa" in cols_req:
        sql = f"""
            SELECT {select_cols}, ROUND((m.monto * :factor)::numeric, 2) AS ejecutado
            FROM movimientos m
            LEFT JOIN financiadores fi ON m.financiador_id = fi.id
            LEFT JOIN regiones re ON m.region_id = re.id
            LEFT JOIN areas ar ON m.area_id = ar.id
            LEFT JOIN rubros ru ON m.rubro_id = ru.id
            LEFT JOIN cuentas cu ON m.cuenta_id = cu.id
            {where_m}
            ORDER BY m.fecha DESC LIMIT 500
        """
    elif "mes" in cols_req:
        sql = f"""
            SELECT m.mes,
                   0::numeric AS presupuesto,
                   ROUND((COALESCE(SUM(m.monto), 0) * :factor)::numeric, 2) AS ejecutado,
                   0::numeric AS saldo,
                   0::numeric AS porcentaje
            FROM movimientos m
            LEFT JOIN financiadores fi ON m.financiador_id = fi.id
            LEFT JOIN regiones re ON m.region_id = re.id
            LEFT JOIN areas ar ON m.area_id = ar.id
            {where_m}
            GROUP BY m.mes ORDER BY m.mes
        """
    else:
        sql = f"""
            WITH p_agg AS (
                SELECT p.gestion, p.financiador_id, p.region_id, p.area_id, cu.rubro_id, p.cuenta_id, SUM(p.monto_inicial) AS ptto
                FROM presupuestos p
                LEFT JOIN cuentas cu ON p.cuenta_id = cu.id
                LEFT JOIN financiadores fi ON p.financiador_id = fi.id
                LEFT JOIN regiones re ON p.region_id = re.id
                LEFT JOIN areas ar ON p.area_id = ar.id
                {where_p}
                GROUP BY p.gestion, p.financiador_id, p.region_id, p.area_id, cu.rubro_id, p.cuenta_id
            ),
            m_agg AS (
                SELECT m.gestion, m.financiador_id, m.region_id, m.area_id, m.rubro_id, m.cuenta_id, SUM(m.monto) AS ejec
                FROM movimientos m
                LEFT JOIN financiadores fi ON m.financiador_id = fi.id
                LEFT JOIN regiones re ON m.region_id = re.id
                LEFT JOIN areas ar ON m.area_id = ar.id
                {where_m}
                GROUP BY m.gestion, m.financiador_id, m.region_id, m.area_id, m.rubro_id, m.cuenta_id
            ),
            unido AS (
                SELECT
                    COALESCE(p.gestion, m.gestion) AS gestion,
                    COALESCE(p.financiador_id, m.financiador_id) AS financiador_id,
                    COALESCE(p.region_id, m.region_id) AS region_id,
                    COALESCE(p.area_id, m.area_id) AS area_id,
                    COALESCE(p.rubro_id, m.rubro_id) AS rubro_id,
                    COALESCE(p.cuenta_id, m.cuenta_id) AS cuenta_id,
                    COALESCE(p.ptto, 0) AS ptto,
                    COALESCE(m.ejec, 0) AS ejec
                FROM p_agg p
                FULL OUTER JOIN m_agg m
                  ON p.gestion = m.gestion AND p.financiador_id = m.financiador_id
                 AND p.region_id = m.region_id AND p.area_id = m.area_id AND p.cuenta_id = m.cuenta_id
            )
            SELECT {select_cols},
                   ROUND((SUM(u.ptto) * :factor)::numeric, 2) AS presupuesto,
                   ROUND((SUM(u.ejec) * :factor)::numeric, 2) AS ejecutado,
                   ROUND(((SUM(u.ptto) - SUM(u.ejec)) * :factor)::numeric, 2) AS saldo,
                   CASE WHEN SUM(u.ptto) > 0 THEN ROUND((SUM(u.ejec) / SUM(u.ptto)) * 100, 2) ELSE 0 END AS porcentaje
            FROM unido u
            LEFT JOIN financiadores fi ON u.financiador_id = fi.id
            LEFT JOIN regiones re ON u.region_id = re.id
            LEFT JOIN areas ar ON u.area_id = ar.id
            LEFT JOIN rubros ru ON u.rubro_id = ru.id
            LEFT JOIN cuentas cu ON u.cuenta_id = cu.id
            GROUP BY {group_cols}
            ORDER BY ejecutado DESC
        """

    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()
        return [dict(r) for r in rows]

@app.get("/api/reportes/pdf")
def descargar_pdf(
    titulo: str = "Reporte Presupuestario", agrupar: str = "rubro",
    gestion: str = None, financiador: str = None, region: str = None,
    area: str = None, moneda: str = "BOB"
):
    datos = generar_reporte(agrupar, gestion, financiador, region, area, moneda)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(letter))
    styles = getSampleStyleSheet()
    elementos = [Paragraph(f"ENSEÑA POR BOLIVIA - {titulo} ({moneda})", styles["Title"])]

    if datos:
        headers = list(datos[0].keys())
        tabla_data = [headers] + [[str(fila[h]) for h in headers] for fila in datos]
        t = Table(tabla_data)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
        ]))
        elementos.append(t)

    doc.build(elementos)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={titulo}_{moneda}.pdf"})
