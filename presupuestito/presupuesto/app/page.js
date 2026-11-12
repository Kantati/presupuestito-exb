"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const REPORTES = {
  "Ejecución por rubro y cuenta": "rubro,cuenta",
  "Ejecución por financiador": "financiador",
  "Ejecución por área y financiador": "area,financiador",
  "Ejecución por región": "region",
  "Ejecución por mes": "mes",
  "Detalle de movimientos": "fecha,rubro,cuenta,financiador,area,region,glosa",
  "Resumen general": "gestion",
};

const bs = (n) => Number(n).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Home() {
  const [reporte, setReporte] = useState("Ejecución por rubro y cuenta");
  const [filtros, setFiltros] = useState({ gestion: "", financiador: "", region: "", area: "" });
  const [filas, setFilas] = useState([]);
  const [msg, setMsg] = useState("");

  async function importar(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const datos = new FormData();
    datos.append("archivo", archivo);
    const r = await fetch("/api/importar", { method: "POST", body: datos });
    const j = await r.json();
    setMsg(`✔ Filas importadas: ${j.importados}`);
  }

  async function vaciar() {
    await fetch("/api/importar", { method: "DELETE" });
    setFilas([]);
    setMsg("Base vaciada");
  }

  async function ver() {
    const q = new URLSearchParams({ agrupar: REPORTES[reporte] });
    for (const k in filtros) if (filtros[k]) q.set(k, filtros[k]);
    const r = await fetch("/api/reportes?" + q);
    setFilas(await r.json());
  }

  function descargarExcel() {
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Reporte");
    XLSX.writeFile(libro, `${reporte}.xlsx`);
  }

  const columnas = filas[0] ? Object.keys(filas[0]) : [];
  const total = filas.reduce((s, f) => s + (f.ejecutado || 0), 0);
  const mayor = filas.reduce((m, f) => (f.ejecutado > (m?.ejecutado ?? -Infinity) ? f : m), null);

  const grafico = filas
    .map((f) => ({
      nombre: columnas.filter((c) => c !== "ejecutado").map((c) => f[c]).join(" · "),
      ejecutado: f.ejecutado,
    }))
    .sort((a, b) => b.ejecutado - a.ejecutado)
    .slice(0, 12);
  const mostrarGrafico = filas.length > 0 && reporte !== "Detalle de movimientos";

  return (
    <>
      <div className="header">
        <h1>Control Presupuestario y Ejecución Financiera</h1>
        <p>Importa la base contable y consulta reportes al instante</p>
      </div>

      <div className="container">
        <div className="card">
          <h3>1. Importar base (Excel)</h3>
          <div className="row">
            <input type="file" accept=".xlsx" onChange={importar} />
            <button className="sec" onClick={vaciar}>Vaciar base</button>
            <span className="msg">{msg}</span>
          </div>
        </div>

        <div className="card">
          <h3>2. Reporte</h3>
          <div className="row">
            <select value={reporte} onChange={(e) => setReporte(e.target.value)}>
              {Object.keys(REPORTES).map((r) => <option key={r}>{r}</option>)}
            </select>
            {["gestion", "financiador", "region", "area"].map((k) => (
              <input
                key={k}
                placeholder={k}
                value={filtros[k]}
                onChange={(e) => setFiltros({ ...filtros, [k]: e.target.value })}
                style={{ width: 120 }}
              />
            ))}
            <button onClick={ver}>Ver reporte</button>
            {filas.length > 0 && <button className="verde" onClick={descargarExcel}>Descargar Excel</button>}
          </div>
        </div>

        {filas.length > 0 && (
          <div className="kpis">
            <div className="kpi"><span>Total ejecutado</span><b>{bs(total)}</b></div>
            <div className="kpi"><span>Filas del reporte</span><b>{filas.length}</b></div>
            {reporte !== "Detalle de movimientos" && mayor && (
              <div className="kpi">
                <span>Mayor ejecución</span>
                <b style={{ fontSize: 16 }}>
                  {columnas.filter((c) => c !== "ejecutado").map((c) => mayor[c]).join(" · ")}
                </b>
              </div>
            )}
          </div>
        )}

        {mostrarGrafico && (
          <div className="card">
            <h3>Gráfico: mayores ejecuciones</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={grafico}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="nombre" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => bs(v)} />
                <Bar dataKey="ejecutado" fill="#2563eb" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {filas.length > 0 && (
          <div className="card tabla">
            <table>
              <thead>
                <tr>{columnas.map((c) => <th key={c} className={c === "ejecutado" ? "num" : ""}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i}>
                    {columnas.map((c) => (
                      <td key={c} className={typeof f[c] === "number" ? "num" : ""}>
                        {typeof f[c] === "number" ? bs(f[c]) : f[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={columnas.length - 1}>TOTAL</td>
                  <td className="num">{bs(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}