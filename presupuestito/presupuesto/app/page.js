"use client";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const REPORTES = {
  "Ejecución por rubro y cuenta": "rubro,cuenta",
  "Ejecución por financiador": "financiador",
  "Ejecución por área y financiador": "area,financiador",
  "Ejecución por región": "region",
  "Ejecución por mes": "mes",
  "Detalle de movimientos": "fecha,rubro,cuenta,financiador,area,region,glosa",
  "Resumen general consolidado": "gestion",
};

const fmt = (n) =>
  Number(n || 0).toLocaleString("es-BO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function Home() {
  const [reporte, setReporte] = useState("Ejecución por rubro y cuenta");
  const [moneda, setMoneda] = useState("BOB");
  const [filtros, setFiltros] = useState({ gestion: "", financiador: "", region: "", area: "" });
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState("");

  // Drill-down (Detalle desplegable al hacer clic en una fila)
  const [detalleSeleccionado, setDetalleSeleccionado] = useState(null);
  const [filasDetalle, setFilasDetalle] = useState([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Autenticación
  const [token, setToken] = useState("");
  const [adminNombre, setAdminNombre] = useState("");
  const [mostrarLogin, setMostrarLogin] = useState(false);
  const [credenciales, setCredenciales] = useState({ email: "", password: "" });

  const simbolo = moneda === "USD" ? "USD" : "Bs";

  useEffect(() => {
    const savedToken = localStorage.getItem("exb_token");
    const savedName = localStorage.getItem("exb_admin");
    if (savedToken) {
      setToken(savedToken);
      setAdminNombre(savedName || "Administrador");
    }
    ver("Ejecución por rubro y cuenta", "BOB");
  }, []);

  async function iniciarSesion(e) {
    e.preventDefault();
    setMsg("");
    const r = await fetch(`${API_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credenciales),
    });
    if (!r.ok) {
      setMsg("❌ Credenciales de administrador incorrectas");
      return;
    }
    const data = await r.json();
    setToken(data.token);
    setAdminNombre(data.nombre);
    localStorage.setItem("exb_token", data.token);
    localStorage.setItem("exb_admin", data.nombre);
    setMostrarLogin(false);
    setMsg(`✔ Sesión iniciada como ${data.nombre}`);
  }

  function cerrarSesion() {
    setToken("");
    setAdminNombre("");
    localStorage.removeItem("exb_token");
    localStorage.removeItem("exb_admin");
    setMsg("Modo consulta pública activado");
  }

  async function importar(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;
    setCargando(true);
    setMsg("⏳ Procesando archivo en PostgreSQL...");
    const datos = new FormData();
    datos.append("archivo", archivo);
    const r = await fetch(`${API_URL}/api/importar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: datos,
    });
    const j = await r.json();
    setCargando(false);
    if (r.ok) {
      setMsg(`✔ Base actualizada: ${j.importados} registros procesados`);
      ver(reporte, moneda);
    } else {
      setMsg(`❌ Error: ${j.detail || "No autorizado"}`);
    }
  }

  async function vaciar() {
    if (!confirm("¿Seguro que deseas vaciar todos los registros presupuestarios?")) return;
    const r = await fetch(`${API_URL}/api/importar`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      setFilas([]);
      setDetalleSeleccionado(null);
      setMsg("✔ Base de datos vaciada");
    }
  }

  async function ver(repSeleccionado = reporte, monSeleccionada = moneda) {
    setCargando(true);
    setDetalleSeleccionado(null);
    const q = new URLSearchParams({
      agrupar: REPORTES[repSeleccionado],
      moneda: monSeleccionada,
    });
    for (const k in filtros) if (filtros[k]) q.set(k, filtros[k]);
    try {
      const r = await fetch(`${API_URL}/api/reportes?` + q);
      const data = await r.json();
      setFilas(Array.isArray(data) ? data : []);
    } catch {
      setMsg("❌ No se pudo conectar con el servidor FastAPI");
    }
    setCargando(false);
  }

  async function abrirDetalle(fila) {
    if (reporte === "Detalle de movimientos") return;
    const q = new URLSearchParams({ moneda });
    for (const k of ["rubro", "cuenta", "financiador", "region", "area", "mes", "gestion"]) {
      if (fila[k] !== undefined && fila[k] !== null) q.set(k, fila[k]);
      else if (filtros[k]) q.set(k, filtros[k]);
    }
    const etiqueta = Object.keys(fila)
      .filter((c) => !["presupuesto", "ejecutado", "saldo", "porcentaje"].includes(c))
      .map((c) => fila[c])
      .join(" · ");

    setDetalleSeleccionado(etiqueta);
    setCargandoDetalle(true);
    const r = await fetch(`${API_URL}/api/detalle?` + q);
    const data = await r.json();
    setFilasDetalle(Array.isArray(data) ? data : []);
    setCargandoDetalle(false);
  }

  function cambiarMoneda(nuevaMoneda) {
    setMoneda(nuevaMoneda);
    ver(reporte, nuevaMoneda);
  }

  function descargarExcel() {
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, `Reporte_${moneda}`);
    XLSX.writeFile(libro, `${reporte}_${moneda}.xlsx`);
  }

  function descargarPDF() {
    const q = new URLSearchParams({
      titulo: reporte,
      agrupar: REPORTES[reporte],
      moneda,
    });
    for (const k in filtros) if (filtros[k]) q.set(k, filtros[k]);
    window.open(`${API_URL}/api/reportes/pdf?` + q, "_blank");
  }

  const columnas = filas[0] ? Object.keys(filas[0]) : [];
  const columnasNumericas = ["presupuesto", "ejecutado", "saldo", "porcentaje"];
  const totalPtto = filas.reduce((s, f) => s + Number(f.presupuesto || 0), 0);
  const totalEjec = filas.reduce((s, f) => s + Number(f.ejecutado || 0), 0);
  const totalSaldo = totalPtto - totalEjec;
  const pctGlobal = totalPtto > 0 ? ((totalEjec / totalPtto) * 100).toFixed(2) : "0.00";

  const grafico = filas
    .map((f) => ({
      nombre: columnas
        .filter((c) => !columnasNumericas.includes(c))
        .map((c) => f[c])
        .join(" · "),
      Presupuesto: Number(f.presupuesto || 0),
      Ejecutado: Number(f.ejecutado || 0),
    }))
    .sort((a, b) => b.Ejecutado - a.Ejecutado)
    .slice(0, 10);

  const mostrarGrafico = filas.length > 0 && reporte !== "Detalle de movimientos";

  return (
    <>
      <div className="header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Control Presupuestario y Ejecución Financiera</h1>
          <p>Portal de Transparencia y Consulta en Tiempo Real</p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Selector de Moneda BOB / USD */}
          <div style={{ display: "flex", background: "rgba(255,255,255,0.15)", borderRadius: 8, padding: 3 }}>
            <button
              onClick={() => cambiarMoneda("BOB")}
              style={{
                background: moneda === "BOB" ? "#fff" : "transparent",
                color: moneda === "BOB" ? "#1e3a8a" : "#fff",
                padding: "5px 12px",
                fontWeight: 700,
              }}
            >
              BOB (Bs)
            </button>
            <button
              onClick={() => cambiarMoneda("USD")}
              style={{
                background: moneda === "USD" ? "#fff" : "transparent",
                color: moneda === "USD" ? "#1e3a8a" : "#fff",
                padding: "5px 12px",
                fontWeight: 700,
              }}
            >
              USD ($)
            </button>
          </div>

          {!token ? (
            <button className="sec" onClick={() => setMostrarLogin(!mostrarLogin)}>
              🔒 Acceso Administrador
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, background: "#dcfce7", color: "#166534", padding: "6px 10px", borderRadius: 6 }}>
                👤 {adminNombre}
              </span>
              <button className="sec" onClick={cerrarSesion}>Salir</button>
            </div>
          )}
        </div>
      </div>

      <div className="container">
        {mostrarLogin && !token && (
          <div className="card" style={{ borderLeft: "4px solid #2563eb" }}>
            <h3>Iniciar Sesión de Administrador</h3>
            <form onSubmit={iniciarSesion} className="row">
              <input
                type="email"
                placeholder="Correo institucional"
                value={credenciales.email}
                onChange={(e) => setCredenciales({ ...credenciales, email: e.target.value })}
                required
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={credenciales.password}
                onChange={(e) => setCredenciales({ ...credenciales, password: e.target.value })}
                required
              />
              <button type="submit">Entrar</button>
            </form>
          </div>
        )}

        {token && (
          <div className="card" style={{ borderLeft: "4px solid #16a34a" }}>
            <h3>Panel de Administración: Carga de Base Contable (Excel)</h3>
            <div className="row">
              <input type="file" accept=".xlsx" onChange={importar} disabled={cargando} />
              <button className="sec" onClick={vaciar} disabled={cargando}>Vaciar base</button>
            </div>
          </div>
        )}

        {msg && <div style={{ marginBottom: 12, fontWeight: 600 }}>{msg}</div>}

        <div className="card">
          <h3>Consulta Dinámica de Reportes {moneda === "USD" && <span style={{ fontSize: 12, color: "#64748b" }}>(Tasa: 6.96 Bs/USD)</span>}</h3>
          <div className="row">
            <select
              value={reporte}
              onChange={(e) => {
                setReporte(e.target.value);
                ver(e.target.value, moneda);
              }}
            >
              {Object.keys(REPORTES).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            {[
              { key: "gestion", label: "Gestión (ej. 2026)" },
              { key: "financiador", label: "Financiador" },
              { key: "region", label: "Región (ej. LP)" },
              { key: "area", label: "Área" },
            ].map((f) => (
              <input
                key={f.key}
                placeholder={f.label}
                value={filtros[f.key]}
                onChange={(e) => setFiltros({ ...filtros, [f.key]: e.target.value })}
                style={{ width: 145 }}
              />
            ))}
            <button onClick={() => ver(reporte, moneda)} disabled={cargando}>
              {cargando ? "Cargando..." : "Consultar"}
            </button>
            {filas.length > 0 && (
              <>
                <button className="verde" onClick={descargarExcel}>Excel (.xlsx)</button>
                <button style={{ background: "#dc2626", color: "#fff" }} onClick={descargarPDF}>PDF (.pdf)</button>
              </>
            )}
          </div>
        </div>

        {filas.length > 0 && reporte !== "Detalle de movimientos" && (
          <div className="kpis">
            <div className="kpi"><span>Presupuesto Vigente ({simbolo})</span><b>{fmt(totalPtto)}</b></div>
            <div className="kpi"><span>Ejecución Acumulada ({simbolo})</span><b>{fmt(totalEjec)}</b></div>
            <div className="kpi"><span>Saldo Disponible ({simbolo})</span><b>{fmt(totalSaldo)}</b></div>
            <div className="kpi"><span>% Ejecución Global</span><b>{pctGlobal}%</b></div>
          </div>
        )}

        {mostrarGrafico && (
          <div className="card">
            <h3>Dashboard: Presupuesto vs. Ejecución ({simbolo})</h3>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={75} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${fmt(v)} ${simbolo}`} />
                <Legend />
                <Bar dataKey="Presupuesto" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Ejecutado" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Modal / Panel de Drill-Down al hacer clic en una fila */}
        {detalleSeleccionado && (
          <div className="card" style={{ borderLeft: "4px solid #f59e0b", background: "#fffbeb" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>🔍 Detalle de comprobantes: {detalleSeleccionado}</h3>
              <button className="sec" onClick={() => setDetalleSeleccionado(null)}>Cerrar detalle ✕</button>
            </div>
            {cargandoDetalle ? (
              <p>Cargando comprobantes...</p>
            ) : filasDetalle.length > 0 ? (
              <div className="tabla" style={{ maxHeight: 280, overflowY: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>FECHA</th>
                      <th>FINANCIADOR</th>
                      <th>REGIÓN</th>
                      <th>GLOSA / REFERENCIA</th>
                      <th className="num">MONTO ({simbolo})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasDetalle.map((d, idx) => (
                      <tr key={idx}>
                        <td>{d.fecha}</td>
                        <td>{d.financiador}</td>
                        <td>{d.region}</td>
                        <td>{d.glosa}</td>
                        <td className="num">{fmt(d.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>Esta partida tiene presupuesto asignado pero aún no registra movimientos ejecutados.</p>
            )}
          </div>
        )}

        {filas.length > 0 ? (
          <div className="card tabla">
            {reporte !== "Detalle de movimientos" && (
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 0 }}>
                💡 Haz clic sobre cualquier fila para desplegar sus comprobantes y glosas individuales.
              </p>
            )}
            <table>
              <thead>
                <tr>
                  {columnas.map((c) => (
                    <th key={c} className={columnasNumericas.includes(c) ? "num" : ""}>
                      {c.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr
                    key={i}
                    onClick={() => abrirDetalle(f)}
                    style={{ cursor: reporte !== "Detalle de movimientos" ? "pointer" : "default" }}
                    title={reporte !== "Detalle de movimientos" ? "Clic para ver detalle de movimientos" : ""}
                  >
                    {columnas.map((c) => (
                      <td key={c} className={columnasNumericas.includes(c) ? "num" : ""}>
                        {columnasNumericas.includes(c)
                          ? c === "porcentaje"
                            ? `${Number(f[c]).toFixed(2)}%`
                            : fmt(f[c])
                          : f[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", color: "#64748b" }}>
            No hay registros cargados aún para mostrar.
          </div>
        )}
      </div>
    </>
  );
}