"use client";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from "recharts";

import AsistenteFlotante from "./AsistenteFlotante";

const API_URL = "http://127.0.0.1:8000";

const REPORTES = {
  "Ejecución por rubro y cuenta": "rubro,cuenta",
  "Ejecución por financiador": "financiador",
  "Ejecución por área y financiador": "area,financiador",
  "Ejecución por región": "region",
  "Ejecución por mes": "mes",
  "Comparativo por gestión": "gestion",
  "Detalle de movimientos": "fecha,rubro,cuenta,financiador,area,region,glosa",
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

  // Detalle desplegable (Drill-Down)
  const [filaSeleccionada, setFilaSeleccionada] = useState(null);
  const [detalleMovs, setDetalleMovs] = useState([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Auditoría de cargas
  const [mostrarAuditoria, setMostrarAuditoria] = useState(false);
  const [auditoria, setAuditoria] = useState([]);

  // Autenticación
  const [token, setToken] = useState("");
  const [adminNombre, setAdminNombre] = useState("");
  const [mostrarLogin, setMostrarLogin] = useState(false);
  const [credenciales, setCredenciales] = useState({ email: "", password: "" });

  const simbolo = moneda === "USD" ? "$us" : "Bs";

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
      ver();
      if (mostrarAuditoria) cargarAuditoria();
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
      setFilaSeleccionada(null);
      setMsg("✔ Base de datos vaciada");
    }
  }

  async function ver(repSeleccionado = reporte, monSeleccionada = moneda) {
    setCargando(true);
    setFilaSeleccionada(null);
    const q = new URLSearchParams({ agrupar: REPORTES[repSeleccionado], moneda: monSeleccionada });
    for (const k in filtros) if (filtros[k]) q.set(k, filtros[k]);
    try {
      const r = await fetch(`${API_URL}/api/reportes?` + q);
      const data = await r.json();
      setFilas(Array.isArray(data) ? data : []);
    } catch {
      setMsg("❌ No se pudo conectar con el servidor FastAPI (puerto 8000)");
    }
    setCargando(false);
  }

  async function abrirDetalleFila(fila, idx) {
    if (reporte === "Detalle de movimientos") return;
    if (filaSeleccionada === idx) {
      setFilaSeleccionada(null);
      return;
    }
    setFilaSeleccionada(idx);
    setCargandoDetalle(true);
    const q = new URLSearchParams({ moneda });
    for (const campo of ["rubro", "cuenta", "financiador", "area", "region", "mes", "gestion"]) {
      if (fila[campo] !== undefined && fila[campo] !== null) {
        q.set(campo, fila[campo]);
      }
    }
    const r = await fetch(`${API_URL}/api/detalle?` + q);
    const data = await r.json();
    setDetalleMovs(Array.isArray(data) ? data : []);
    setCargandoDetalle(false);
  }

  async function cargarAuditoria() {
    const nuevoEstado = !mostrarAuditoria;
    setMostrarAuditoria(nuevoEstado);
    if (nuevoEstado) {
      const r = await fetch(`${API_URL}/api/auditoria`);
      const data = await r.json();
      setAuditoria(Array.isArray(data) ? data : []);
    }
  }

  function descargarExcel() {
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Reporte");
    XLSX.writeFile(libro, `${reporte}_${moneda}.xlsx`);
  }

  function descargarPDF() {
    const q = new URLSearchParams({ titulo: reporte, agrupar: REPORTES[reporte], moneda });
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
      <div className="header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1>Control Presupuestario y Ejecución Financiera</h1>
          <p>Portal de Transparencia y Consulta en Tiempo Real · Enseña por Bolivia</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="sec" onClick={cargarAuditoria}>
            📋 Historial de Cargas
          </button>
          {!token ? (
            <button className="sec" onClick={() => setMostrarLogin(!mostrarLogin)}>
              🔒 Acceso Administrador
            </button>
          ) : (
            <>
              <span style={{ fontSize: 13, background: "#dcfce7", color: "#166534", padding: "6px 10px", borderRadius: 6 }}>
                👤 {adminNombre}
              </span>
              <button className="sec" onClick={cerrarSesion}>Salir</button>
            </>
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

        {mostrarAuditoria && (
          <div className="card" style={{ borderLeft: "4px solid #6366f1" }}>
            <h3>Bitácora de Auditoría e Importaciones</h3>
            {auditoria.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Fecha y Hora</th>
                    <th>Archivo Excel</th>
                    <th>Gestión</th>
                    <th className="num">Registros</th>
                    <th>Responsable</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {auditoria.map((a) => (
                    <tr key={a.id}>
                      <td>{a.fecha}</td>
                      <td>{a.nombre_archivo}</td>
                      <td>{a.gestion}</td>
                      <td className="num">{a.filas_procesadas}</td>
                      <td>{a.usuario}</td>
                      <td>✔ {a.estado}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ color: "#64748b", fontSize: 14 }}>No hay cargas registradas aún.</p>
            )}
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
          <h3>Consulta Dinámica de Reportes</h3>
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

            <select
              value={moneda}
              onChange={(e) => {
                setMoneda(e.target.value);
                ver(reporte, e.target.value);
              }}
              style={{ fontWeight: 600, background: "#f8fafc" }}
            >
              <option value="BOB">Moneda: Bolivianos (Bs)</option>
              <option value="USD">Moneda: Dólares ($us · TC 6.96)</option>
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
                style={{ width: 135 }}
              />
            ))}
            <button onClick={() => ver()} disabled={cargando}>
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
            <h3>Dashboard: Presupuesto vs. Ejecución en {simbolo} (Top 10)</h3>
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

        {filas.length > 0 ? (
          <div className="card tabla">
            {reporte !== "Detalle de movimientos" && (
              <p style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
                💡 Haz clic en cualquier fila para desplegar los comprobantes y movimientos individuales que la componen.
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
                  <>
                    <tr
                      key={i}
                      onClick={() => abrirDetalleFila(f, i)}
                      style={{
                        cursor: reporte !== "Detalle de movimientos" ? "pointer" : "default",
                        background: filaSeleccionada === i ? "#eff6ff" : undefined,
                      }}
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
                    {filaSeleccionada === i && (
                      <tr>
                        <td colSpan={columnas.length} style={{ background: "#f8fafc", padding: 14 }}>
                          <strong>Comprobantes detallados ({simbolo}):</strong>
                          {cargandoDetalle ? (
                            <p>Cargando movimientos...</p>
                          ) : detalleMovs.length > 0 ? (
                            <table style={{ marginTop: 8, fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>Fecha</th>
                                  <th>Financiador</th>
                                  <th>Región</th>
                                  <th>Área</th>
                                  <th>Cuenta</th>
                                  <th>Glosa / Referencia</th>
                                  <th className="num">Monto ({simbolo})</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detalleMovs.map((m, idx) => (
                                  <tr key={idx}>
                                    <td>{m.fecha}</td>
                                    <td>{m.financiador}</td>
                                    <td>{m.region}</td>
                                    <td>{m.area}</td>
                                    <td>{m.cuenta}</td>
                                    <td>{m.glosa}</td>
                                    <td className="num">{fmt(m.monto)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p style={{ color: "#64748b", marginTop: 6 }}>No hay movimientos ejecutados en esta fila (solo presupuesto inicial).</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", color: "#64748b" }}>
            No hay registros cargados aún para mostrar. Un administrador debe importar la base contable desde el botón superior derecho.
          </div>
        )}
      </div>

      <AsistenteFlotante
     apiUrl={API_URL}
     reporte={reporte}
     moneda={moneda}
     filas={filas}
   />
 
    </>
  );
}