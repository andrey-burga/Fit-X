# VIGORCORE — REPORTE DE INVENTARIO ESTRUCTURAL CLOUD FIRESTORE

Este informe documenta la estructura de colecciones, jerarquías de documentos y preparación para la migración de datos hacia **Zoho Catalyst NoSQL**, utilizando descubrimiento read-only mediante la API REST oficial de Firestore v1 y credenciales ADC en Windows.

---

## 1. RESUMEN DE EJECUCIÓN Y ACCESO

| Parámetro | Detalle / Valor |
| :--- | :--- |
| **Proyecto GCP** | `gen-lang-client-0041212770` |
| **Database ID (Named)** | `ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c` |
| **Edición / Región** | `ENTERPRISE` / `us-east1` |
| **Identidad ADC Confirmada** | `jhonyandreyburga@gmail.com` (`roles/owner`) |
| **Estado de Facturación GCP** | Deshabilitada / Cerrada (No requerida para lectura REST administrativa) |
| **Método de Inspección** | REST API v1 (`POST :listCollectionIds`, `GET /documents`) |
| **Protección de Datos** | `mask.fieldPaths=__none__` (**Privacidad total garantizada**) |

---

## 2. ESQUEMA DE COLECCIONES Y MAPEO A ZOHO CATALYST NoSQL

| Colección Firestore | Nivel | Propósito en VigorCore | Tabla Sugerida en Catalyst NoSQL | Partition Key (PK) | Sort Key (SK) / Índice |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `athletes` | Raíz | Perfiles de atletas, métricas base | `athletes` | `athlete_id` (String) | `created_at` |
| `trainers` | Raíz | Perfiles de entrenadores y staff | `trainers` | `trainer_id` (String) | `role` |
| `athletes/{id}/workouts` | Subcol L1 | Sesiones de entrenamiento | `workouts` *(Aplanada)* | `athlete_id` (String) | `workout_date` |
| `athletes/{id}/nutrition` | Subcol L1 | Planes y registros nutricionales | `nutrition_plans` *(Aplanada)* | `athlete_id` (String) | `plan_id` |
| `invitations` | Raíz | Tokens de invitación con hash SHA-256 | `invitations` | `token_hash` (String) | `expires_at` |
| `security_audit` | Raíz | Logs de auditoría de seguridad | `security_audit` | `tenant_id` (String) | `timestamp` |
| `locks` | Raíz | Locks distribuidos / fencing tokens | `locks` | `resource_id` (String) | `lease_expires_at` |
| `_system_` | Raíz | Metadatos y sondas de verificación | `system_meta` | `key` (String) | `updated_at` |

---

## 3. GARANTÍAS DE SEGURIDAD Y PRIVACIDAD

1. **Cero Exfiltración de Datos de Atletas:** La herramienta de inventario consulta Firestore con la máscara de proyección `mask.fieldPaths=__none__`. La API de Google Cloud devuelve únicamente metadatos del recurso (`name`, `createTime`, `updateTime`) sin transmitir atributos biométricos, cargas, repeticiones ni detalles nutricionales.
2. **Cero Escrituras / Mutaciones:** El script de inventario no realiza ninguna llamada `PATCH`, `PUT`, `DELETE` ni transacciones. Cero impacto en el estado actual de la base de datos.
3. **Respeto a Cuotas y Rate Limiting:** En modo Deep, las llamadas REST implementan retardo configurado (`ThrottleMs: 50`) y reintentos con retroceso exponencial (`exponential backoff`) en códigos 429 y 503.

---

## 4. INSTRUCCIONES DE EJECUCIÓN LOCAL EN WINDOWS

### Modo Shallow (Recomendado para primera verificación):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Shallow
```

### Modo Deep (Recursivo completo con checkpoint):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Deep
```

### Reanudación de inventario interrumpido:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\poc\catalyst-3-2\scripts\inventory-firestore.ps1 -Mode Deep -Resume
```
