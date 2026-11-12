import * as XLSX from "xlsx";
import db from "@/lib/db";

export async function POST(req) {
  const form = await req.formData();
  const archivo = form.get("archivo");
  const wb = XLSX.read(Buffer.from(await archivo.arrayBuffer()), {
    type: "buffer",
    cellDates: true,
  });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  const insertar = db.prepare(`
    INSERT INTO movimientos (gestion, fecha, rubro, cuenta, financiador, area, region, monto, glosa)
    VALUES (@gestion, @fecha, @rubro, @cuenta, @financiador, @area, @region, @monto, @glosa)
  `);

  const cargar = db.transaction((lista) => {
    for (const f of lista) {
      const r = {};
      for (const k in f) r[k.trim().toLowerCase()] = f[k];

      const fecha = r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha ?? "");
      insertar.run({
        gestion: Number(r.gestion) || Number(fecha.slice(0, 4)) || null,
        fecha,
        rubro: String(r.rubro ?? "").trim(),
        cuenta: String(r.cuenta ?? "").trim(),
        financiador: String(r.financiador ?? "").trim(),
        area: String(r.area ?? "").trim(),
        region: String(r.region ?? "").trim(),
        monto: Number(r.monto) || 0,
        glosa: String(r.glosa ?? "").trim(),
      });
    }
  });

  cargar(filas);
  return Response.json({ importados: filas.length });
}

export async function DELETE() {
  db.exec("DELETE FROM movimientos");
  return Response.json({ ok: true });
}