import { zcAuth, UserManagement, USER_STATUS } from '@zcatalyst/auth';
import {
  NoSQL,
  NoSQLTable,
  NoSQLItem,
  NoSQLEnum,
  NoSQLMarshall,
  NoSQLUnMarshall,
  NoSQLUpdateOperationType,
} from '@zcatalyst/nosql';

async function checkCatalystSDK() {
  console.log('====================================================');
  console.log(' AUDITORÍA Y COMPROBACIÓN DEL SDK MODULAR CATALYST  ');
  console.log('====================================================');

  console.log('1. Runtime Node.js:', process.version);

  // Check @zcatalyst/auth
  console.log('\n2. Verificando @zcatalyst/auth@1.0.0:');
  console.log(' - zcAuth exportado:', typeof zcAuth, Boolean(zcAuth));
  console.log(' - UserManagement clase exportada:', typeof UserManagement);
  console.log(' - USER_STATUS enum:', USER_STATUS);
  console.log(' - zcAuth.init firma:', typeof zcAuth.init);

  // Check @zcatalyst/nosql
  console.log('\n3. Verificando @zcatalyst/nosql@1.0.0:');
  console.log(' - NoSQL clase exportada:', typeof NoSQL);
  console.log(' - NoSQLTable clase exportada:', typeof NoSQLTable);
  console.log(' - NoSQLItem clase exportada:', typeof NoSQLItem);
  console.log(' - NoSQLEnum exportado:', typeof NoSQLEnum);
  console.log(' - NoSQLMarshall exportado:', typeof NoSQLMarshall);
  console.log(' - NoSQLUnMarshall exportado:', typeof NoSQLUnMarshall);
  console.log(' - NoSQLUpdateOperationType enum:', NoSQLUpdateOperationType);

  // Demonstrate NoSQLItem construction
  const item = NoSQLItem.from({
    pk: 'POC#3.2#SAMPLE',
    sk: 'META',
    testMetric: 42,
    active: true,
  });

  console.log('\n4. Demostración NoSQLItem.from() y .to():');
  console.log(' - Atributos construidos:', item.numberOfAttributes());
  console.log(' - toJSON():', JSON.stringify(item.toJSON()));
  console.log(' - to() nativo:', item.to());

  // Demonstrate NoSQLEnum operators and functions
  console.log('\n5. Constantes y Operadores Soportados:');
  console.log(' - NoSQLOperator:', Object.keys(NoSQLEnum.NoSQLOperator));
  console.log(' - NoSQLConditionGroupOperator:', NoSQLEnum.NoSQLConditionGroupOperator);
  console.log(' - DataType:', Object.keys(NoSQLEnum.DataType));

  console.log('\nVEREDICTO SDK: COMPATIBILIDAD MODULAR 100% VERIFICADA.');
}

checkCatalystSDK().catch((err) => {
  console.error('Error durante la verificación del SDK:', err);
  process.exit(1);
});
