import db from "@/lib/db";

const PERMITIDOS = ["gestion", "fecha", "mes", "rubro", "cuenta", "financiador", "area", "region", "glosa"];

export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const agrupar = (p.get("agrupar") || "rubro").split(",").map((c) => c.trim());

  if (!agrupar.every((c) => PERMITIDOS.includes(c))) {
    return Response.json({ error: "Columna no permitida" }, { status: 400 });
  }

  const expr = (c) => (c === "mes" ? "substr(fecha, 1, 7)" : c);
  const cols = agrupar.map((c) => `${expr(c)} AS ${c}`).join(", ");
  const grupo = agrupar.map(expr).join(", ");

  let sql = `SELECT ${cols}, ROUND(SUM(monto), 2) AS ejecutado FROM movimientos WHERE 1=1`;
  const valores = [];
  for (const filtro of ["gestion", "financiador", "region", "area", "rubro"]) {
    if (p.get(filtro)) {
      sql += ` AND ${filtro} = ?`;
      valores.push(p.get(filtro));
    }
  }
  sql += ` GROUP BY ${grupo} ORDER BY ${grupo}`;

  return Response.json(db.prepare(sql).all(...valores));
}