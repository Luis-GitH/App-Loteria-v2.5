import fs from "fs";
import path from "path";

function serializeArgs(args) {
    return args
        .map((a) => {
            if (typeof a === "string") return a;
            if (a instanceof Error) return a.stack || a.message;
            try {
                return JSON.stringify(a);
            } catch {
                return String(a);
            }
        })
        .join(" ");
}

export function createLogger(logFilePath) {
    const baseConsole = { log: console.log, error: console.error };
    const dir = path.dirname(logFilePath);
    let stream = null;
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        stream = fs.createWriteStream(logFilePath, { flags: "a" });
    } catch (err) {
        baseConsole.error(
            `[logger] No se pudo abrir el log ${logFilePath}:`,
            err.message || err
        );
        // Fallback a /tmp para no perder trazas (cron/pm2 sin permisos)
        try {
            const fallback = path.join("/tmp", path.basename(logFilePath));
            baseConsole.error(`[logger] Intentando fallback en ${fallback}`);
            stream = fs.createWriteStream(fallback, { flags: "a" });
        } catch (e2) {
            baseConsole.error(
                `[logger] Tampoco se pudo abrir fallback:`,
                e2.message || e2
            );
            stream = null;
        }
    }
    let closed = false;

    const write = (prefix, args) => {
        if (closed || !stream) return;
        const line = serializeArgs(args);
        stream.write(`${prefix}${line}\n`);
    };

    const log = (...args) => {
        if (stream) write("", args);
        baseConsole.log(...args);
    };

    const error = (...args) => {
        if (stream) write("[ERROR] ", args);
        baseConsole.error(...args);
    };

    const header = (text) => {
        if (stream) write("", [text]);
        baseConsole.log(text);
    };

    const close = async () => {
        if (closed || !stream) return;
        closed = true;
        await new Promise((resolve) => stream.end(resolve));
    };

    const hookConsole = () => {
        const original = { log: console.log, error: console.error };
        console.log = log;
        console.error = error;
        return async () => {
            console.log = original.log;
            console.error = original.error;
            await close();
        };
    };

    return { log, error, header, hookConsole, close };
}
