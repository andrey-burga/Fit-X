# VIGORCORE — FASE 3.5.0: FORMATO Y ESTRUCTURA DEL CACHÉ LOCAL PROTEGIDO

## 1. ORGANIZACIÓN DEL DIRECTORIO DE CACHÉ

Directorio: `poc/catalyst-3-2/.data/firestore-export/` (Excluido de Git vía `.gitignore` y protegido por ACL en Windows).

```
.data/firestore-export/
├── doc-000001.bin           # Sobre cifrado DPAPI (Documento 1)
├── doc-000002.bin           # Sobre cifrado DPAPI (Documento 2)
├── ...
├── doc-000073.bin           # Sobre cifrado DPAPI (Documento 73)
├── checkpoint.bin           # Estado atómico del proceso cifrado con DPAPI
└── id-mapping.bin           # Tabla de correspondencia interna cifrada con DPAPI
```

---

## 2. ESTRUCTURA DEL SOBRE CIFRADO INDIVIDUAL (`doc-XXXXXX.bin`)

Cada archivo en disco es un binario cifrado mediante Windows DPAPI (`DataProtectionScope.CurrentUser`). 

Al descifrarse en memoria durante la ejecución, contiene el siguiente JSON estructurado:

```typescript
interface EncryptedDocumentEnvelope {
  /** Versión del esquema del sobre */
  version: "1.0.0";

  /** Índice secuencial numérico */
  docIndex: number;

  /** Identificador opaco del archivo (ej. "doc-000001") */
  opaqueId: string;

  /** Ruta completa del recurso Firestore en origen */
  sourceResourcePath: string;

  /** Alias determinista del usuario (ej. "USER_001") */
  userAlias: string;

  /** Colección o subcolección a la que pertenece */
  collectionId: string;

  /** Identificador nativo del documento en Firestore */
  documentId: string;

  /** Sello de creación provisto por Firestore */
  createTime: string;

  /** Sello de última modificación provisto por Firestore */
  updateTime: string;

  /** Instante UTC exacto de la extracción en el cliente */
  extractedAtUtc: string;

  /** Hash SHA-256 canónico del documento REST original */
  contentSha256: string;

  /** Carga útil completa retornada por Firestore REST v1 */
  rawRestDocument: Record<string, any>;
}
```

### Propiedades de Seguridad del Sobre
1. **Identificadores Opacos:** Los nombres de archivo nunca utilizan UIDs, emails ni nombres de atletas (`doc-000001.bin`).
2. **Integridad Canónica:** El campo `contentSha256` se calcula sobre la representación JSON canónica de `rawRestDocument` antes de cifrarlo.
3. **Escritura Atómica:** El archivo se escribe primero como `doc-XXXXXX.bin.tmp` y luego se reemplaza atómicamente con `Move-Item -Force`, evitando archivos truncados ante una interrupción.

---

## 3. CHECKPOINT CIFRADO (`checkpoint.bin`)

El archivo `checkpoint.bin` preserva el progreso de la extracción y se actualiza atómicamente cada 10 documentos y al concluir el lote. Al descifrarse, contiene:

```json
{
  "extractorVersion": "1.0.0",
  "timestampUtc": "2026-11-10T17:35:00.0000000Z",
  "nextDocIndex": 74,
  "status": "COMPLETED",
  "confirmedCount": 73,
  "confirmedDocIds": [
    "doc-000001",
    "doc-000002",
    "..."
  ]
}
```

---

## 4. TABLA DE CORRESPONDENCIA CIFRADA (`id-mapping.bin`)

Contiene la correlación interna entre identificadores opacos, alias de usuario y rutas Firestore. Solo existe descifrada en memoria:

```json
{
  "doc-000001": {
    "userAlias": "USER_001",
    "collectionId": "users",
    "resourcePath": "projects/.../databases/.../documents/users/[UID_1]",
    "createTime": "2026-10-01T10:00:00Z",
    "updateTime": "2026-10-01T10:00:00Z",
    "fileBytes": 1420
  }
}
```

---

## 5. MANIFIESTO PÚBLICO DE AUDITORÍA (`manifest-audit.json`)

Ubicación: `poc/catalyst-3-2/reports/firestore-extraction-3.5/manifest-audit.json`

Este archivo es público y legible, y contiene **exclusivamente datos agregados y sanitizados**:

```json
{
  "extractorVersion": "1.0.0",
  "executionId": "c4d3e2f1-9876-5432-10fe-ba9876543210",
  "extractedAtUtc": "2026-11-10T17:36:00.0000000Z",
  "totalDocumentsExtracted": 73,
  "userAliases": ["USER_001", "USER_002", "USER_003", "USER_004", "USER_005"],
  "countsByCollection": {
    "users": 5,
    "biometrics": 5,
    "groceries": 43,
    "preferences": 5,
    "mealLogs": 4,
    "notifications": 6,
    "workoutSessions": 3,
    "executedWorkouts": 2
  },
  "countsByUser": {
    "USER_001": { "users": 1, "biometrics": 1, "groceries": 10, ... },
    ...
  },
  "status": "COMPLETED_SUCCESS",
  "totalEncryptedBytes": 115420,
  "sanitizedErrors": [],
  "consistencyVerdict": "STABLE_DURING_OBSERVED_WINDOW",
  "consistencyDrifts": []
}
```
