-- ============================================================
-- Script para limpiar rutas de imagen en BD
-- Cambia "/historico/filename" -> "filename" en todos los boletos
-- ============================================================

-- 1️⃣ PRIMITIVA: Limpiar rutas de imagen
UPDATE primitiva
SET imagen = SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1)
WHERE imagen IS NOT NULL 
  AND imagen <> '' 
  AND (imagen LIKE '/historico/%' OR imagen LIKE '%/%');

-- Verificar cambios
SELECT COUNT(*) AS primitiva_count, 
       GROUP_CONCAT(DISTINCT imagen LIMIT 5) AS sample_images
FROM primitiva
WHERE imagen IS NOT NULL AND imagen <> '';

-- ============================================================

-- 2️⃣ EUROMILLONES: Limpiar rutas de imagen
UPDATE euromillones
SET imagen = SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1)
WHERE imagen IS NOT NULL 
  AND imagen <> '' 
  AND (imagen LIKE '/historico/%' OR imagen LIKE '%/%');

-- Verificar cambios
SELECT COUNT(*) AS euromillones_count, 
       GROUP_CONCAT(DISTINCT imagen LIMIT 5) AS sample_images
FROM euromillones
WHERE imagen IS NOT NULL AND imagen <> '';

-- ============================================================

-- 3️⃣ GORDO: Limpiar rutas de imagen
UPDATE gordo
SET imagen = SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1)
WHERE imagen IS NOT NULL 
  AND imagen <> '' 
  AND (imagen LIKE '/historico/%' OR imagen LIKE '%/%');

-- Verificar cambios
SELECT COUNT(*) AS gordo_count, 
       GROUP_CONCAT(DISTINCT imagen LIMIT 5) AS sample_images
FROM gordo
WHERE imagen IS NOT NULL AND imagen <> '';

-- ============================================================
-- RESUMEN
-- ============================================================
SELECT 
  'primitiva' AS tabla,
  COUNT(*) AS total_registros,
  SUM(CASE WHEN imagen IS NOT NULL AND imagen <> '' THEN 1 ELSE 0 END) AS con_imagen
FROM primitiva
UNION ALL
SELECT 
  'euromillones' AS tabla,
  COUNT(*) AS total_registros,
  SUM(CASE WHEN imagen IS NOT NULL AND imagen <> '' THEN 1 ELSE 0 END) AS con_imagen
FROM euromillones
UNION ALL
SELECT 
  'gordo' AS tabla,
  COUNT(*) AS total_registros,
  SUM(CASE WHEN imagen IS NOT NULL AND imagen <> '' THEN 1 ELSE 0 END) AS con_imagen
FROM gordo;
