// src/modules/dbConnection.js
import mariadb from "mariadb";
import { dbConfig } from "../config/dbConfig.js";

export const pool = mariadb.createPool(dbConfig);

export async function getConnection() {
  return await pool.getConnection();
}
