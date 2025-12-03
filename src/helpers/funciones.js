import nodemailer from "nodemailer";

// Configuracion de correo
const MAIL_CONFIG = {
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: "Verificacion semanal de resultados de Loterias",
    smtp: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
        },
    },
};

export async function enviarCorreo(resumen, adjuntos = []) {
    try {
        const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
        await transporter.sendMail({
            from: MAIL_CONFIG.from,
            to: MAIL_CONFIG.to,
            subject: MAIL_CONFIG.subject,
            html: `
        <h2>Comprobacion de los resultados</h2>
        <p>A fecha: ${new Date().toLocaleString("es-ES")}</p>
        <pre style="font-family: monospace; white-space: pre-wrap;">${resumen}</pre>
        `,
            attachments: adjuntos,
        });
        console.log("Correo enviado con", adjuntos.length, "imagen(es).");
    } catch (err) {
        console.error("Error enviando correo:", err.message);
    }
}

export function dividirCadena(cadena, tamanoGrupo = 2) {
    const resultado = [];
    const s = (cadena || "").toString().replace(/\s+/g, "");
    if (!s) return resultado;
    const grupo = Math.max(1, tamanoGrupo);
    for (let i = 0; i < s.length; i += grupo) {
        const segmento = s.slice(i, i + grupo);
        const digits = segmento.replace(/\D+/g, "");
        if (!digits) continue;
        const width = Math.max(grupo, digits.length);
        resultado.push(digits.padStart(width, "0"));
    }
    return resultado;
}

export function numeroTo2Digitos(num) {
    return num.toString().padStart(2, "0");
}

export function parseNumberOrNull(v) {
    if (v === null || typeof v === "undefined") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export function formatEuroText(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `${n.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })} \u20ac`;
}

export function sorteoNumeroNNN(valor) {
    // Los scrapers ya guardan el sorteo normalizado a tres dígitos.
    // Mantén sólo un saneado mínimo: número => padStart(3), cadena => trim.
    if (typeof valor === "number") return valor.toString().padStart(3, "0");
    const s = (valor || "").toString().trim();
    if (!s) return "";
    return /^\d{1,3}$/.test(s) ? s.padStart(3, "0") : s;
}
