// usa los datos de ENV para inicializar la base de datos
// y crear el pool de conexiones
// si no existe la DB no se puede abrir un pool con ella
// Los pasos serian:
// Crear el pool de conexion sin base de datos
// Esto genera un pool valido para crearla
// Se verifica si existe y sino se crea y se cierra el pool.
// Ahora se puede hacer la conexion de un nuevo pool con la base de datos
//

import "dotenv/config";
import mariadb from "mariadb";

export default async function inicializaDB() {
    let conn;
    let pool;
    let resultado = false;

    // 1. Crear un nuevo pool de conexiones que NO incluya la base de datos
    try {
        pool = mariadb.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            // No incluya la opción 'database'
            connectionLimit: 5,
        });
        // console.log('Pool de conexiones creado con éxito.');

        // 2. Obtener una conexión del pool.
        conn = await pool.getConnection();
        // console.log('Conexión obtenida del pool.');

        // 3. Usar la conexión para crear la base de datos si no existe.
        const dbName = process.env.DB_DATABASE;
        await conn.query(`CREATE DATABASE IF NOT EXISTS ${dbName};`);
        console.log(`Base de datos '${dbName}' creada con éxito.`);
        resultado = true;
    } catch (err) {
        console.error("Error durante la creación de la base de datos:", err);
        resultado = false;
    } finally {
    }

    // const conn = await pool.getConnection();
    try {
        await conn.query(`
          CREATE DATABASE IF NOT EXISTS boletos_loteria
                  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    `);
        await conn.query(`USE boletos_loteria;`);

        // --- Tabla PRIMITIVA ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS primitiva (
            identificador VARCHAR(40) PRIMARY KEY,
            sorteoCodigo VARCHAR(20),
            fechaLunes DATE,
            combinacion VARCHAR(60),
            reintegro VARCHAR(5),
            semanas INT,
            terminal VARCHAR(20),
            joker VARCHAR(20),
            imagen VARCHAR(255)
          )ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
    `);

        // --- Tabla EUROMILLONES ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS euromillones (
            identificador VARCHAR(40) PRIMARY KEY,
            sorteoCodigo VARCHAR(20),
            fechaLunes DATE,
            combinacion VARCHAR(60),
            estrellas VARCHAR(10),
            millon VARCHAR(10),
            semanas INT,
            terminal VARCHAR(20),
            imagen VARCHAR(255)
          )ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
    `);

        // --- Tabla EL GORDO ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS gordo (
            identificador VARCHAR(40) PRIMARY KEY,
            sorteoCodigo VARCHAR(20),
            fechaLunes DATE,
            combinacion VARCHAR(60),
            clave VARCHAR(10),
            semanas INT,
            terminal VARCHAR(20),
            imagen VARCHAR(255)
          )ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
    `);

        // --- Tabla SORTEOS ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS sorteos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            identificadorBoleto VARCHAR(40) NOT NULL,
            tipoApuesta VARCHAR(20) NOT NULL,
            sorteo INT NOT NULL,
            fecha DATE NOT NULL,
            dia VARCHAR(12) NOT NULL,
            lunesSemana DATE NOT NULL,
            UNIQUE (identificadorBoleto, tipoApuesta, sorteo)
          )ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
    `);
        //tablas de los resultados de los sorteos
        // --- Tabla R_euromillones ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS R_euromillones (
            id int(11) NOT NULL AUTO_INCREMENT,
            semana varchar(10) DEFAULT NULL,
            sorteo varchar(10) DEFAULT NULL,
            fecha varchar(20) DEFAULT NULL,
            numeros varchar(100) DEFAULT NULL,
            estrellas varchar(50) DEFAULT NULL,
            elMillon varchar(20) DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY sorteo (sorteo)
          ) ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
        `);
        // --- Tabla R_primitiva ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS R_gordo (
            id int(11) NOT NULL AUTO_INCREMENT,
            semana varchar(10) DEFAULT NULL,
            sorteo varchar(10) DEFAULT NULL,
            fecha varchar(20) DEFAULT NULL,
            numeros varchar(100) DEFAULT NULL,
            numeroClave varchar(10) DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY sorteo (sorteo)
          ) ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
        `);
        // --- Tabla R_primitiva ---
        await conn.query(`
          CREATE TABLE IF NOT EXISTS R_primitiva (
            id int(11) NOT NULL AUTO_INCREMENT,
            semana varchar(10) DEFAULT NULL,
            sorteo varchar(10) DEFAULT NULL,
            fecha varchar(20) DEFAULT NULL,
            numeros varchar(100) DEFAULT NULL,
            complementario varchar(10) DEFAULT NULL,
            reintegro varchar(10) DEFAULT NULL,
            joker varchar(20) DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY sorteo (sorteo)
          ) ENGINE=InnoDB AUTO_INCREMENT=209 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
        `);

        //tabla premios_sorteos
        await conn.query(`
          CREATE TABLE IF NOT EXISTS premios_sorteos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tipoApuesta VARCHAR(20) NOT NULL,     -- euromillones / primitiva / gordo
            sorteo VARCHAR(30) NOT NULL,          -- nº o código de sorteo (en primitiva suele ser el segundo tramo)
            fecha DATE NOT NULL,
            categoria VARCHAR(10) NOT NULL,       -- "1ª", "2ª", ... (guardamos ordinal)
            aciertos VARCHAR(30) NOT NULL,        -- "5+2", "6", "5+compl", "3+clave", etc.
            premio DECIMAL(12,2) NOT NULL,        -- 11.58
            premio_text VARCHAR(32) NOT NULL,     -- "11,58 €"
            UNIQUE KEY u1 (tipoApuesta, sorteo, categoria)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        console.log(
            `✅ DataBase: ${process.env.DB_DATABASE}, Tablas: 'Boletos y resultados preparados.`
        );
    } catch (err) {
        console.error("❌ Error inicializando base de datos:", err.message);
    } finally {
        if (conn) conn.release();
        // ✅ Cerrar el pool después de crear tablas
        await pool.end();
        console.log("🔒 Conexión a MariaDB cerrada correctamente.");
        conn.release();
    }
    return resultado;
}
