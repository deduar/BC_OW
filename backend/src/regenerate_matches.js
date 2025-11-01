const mongoose = require('mongoose');
const Match = require('./models/Match');
const Transaction = require('./models/Transaction');
const optimizedTransactionService = require('./services/optimizedTransactionService');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

async function regenerateMatches() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('REGENERACIÓN DE MATCHES');
    console.log('='.repeat(80));
    console.log('');

    // 1. Obtener todos los userIds que tienen transacciones
    const userIds = await Transaction.distinct('userId');
    console.log(`📊 Usuarios encontrados: ${userIds.length}\n`);

    if (userIds.length === 0) {
      console.log('⚠️ No hay usuarios con transacciones');
      await mongoose.disconnect();
      return;
    }

    // 2. Para cada usuario, eliminar matches existentes y regenerar
    for (const userId of userIds) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Procesando usuario: ${userId}`);
      console.log('='.repeat(80));

      // Obtener conteos antes
      const oldMatchesCount = await Match.countDocuments({ userId });
      console.log(`Matches existentes: ${oldMatchesCount}`);

      const fuerzaCount = await Transaction.countDocuments({ userId, type: 'fuerza_movil' });
      const bankCount = await Transaction.countDocuments({ userId, type: 'bank' });
      console.log(`Transacciones FM: ${fuerzaCount}`);
      console.log(`Transacciones Bank: ${bankCount}`);

      if (fuerzaCount === 0 || bankCount === 0) {
        console.log('⚠️ No hay suficientes transacciones para hacer matching');
        continue;
      }

      // Eliminar matches existentes
      console.log('\n🗑️ Eliminando matches existentes...');
      const deleteResult = await Match.deleteMany({ userId });
      console.log(`✅ Eliminados ${deleteResult.deletedCount} matches`);

      // Ejecutar matching
      console.log('\n🔄 Ejecutando matching...');
      const result = await optimizedTransactionService.runOptimizedMatching(userId);
      
      console.log(`✅ Matching completado:`);
      console.log(`   Matches encontrados: ${result.matchesFound || 0}`);
      console.log(`   Transacciones FM procesadas: ${result.fuerzaTransactions || fuerzaCount}`);
      console.log(`   Transacciones Bank procesadas: ${result.bankTransactions || bankCount}`);
    }

    // 3. Analizar resultados finales
    console.log('\n' + '='.repeat(80));
    console.log('ANÁLISIS DE RESULTADOS');
    console.log('='.repeat(80));

    const totalMatches = await Match.countDocuments({});
    console.log(`\nTotal de matches en la colección: ${totalMatches}\n`);

    // Analizar los primeros 20 matches
    const matches = await Match.find({})
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    console.log('Primeros 20 matches:\n');
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const fmTx = await Transaction.findById(match.fuerzaTransactionId);
      const bankTx = await Transaction.findById(match.bankTransactionId);

      if (fmTx && bankTx) {
        const fmMainRef = (fmTx.reference || '').replace(/[^\d]/g, '');
        const fmPaymentRef = (fmTx.paymentReference || '').toString().replace(/[^\d]/g, '');
        const bankRef = (bankTx.reference || '').replace(/[^\d]/g, '');

        // Validar según las reglas
        let isValid = false;
        let reason = '';

        if (fmMainRef.length >= 4 && bankRef.includes(fmMainRef)) {
          isValid = true;
          reason = 'mainRef match';
        } else if (fmPaymentRef.length >= 4 && bankRef.includes(fmPaymentRef)) {
          // Check if paymentRef is well-positioned (start or end)
          const index = bankRef.indexOf(fmPaymentRef);
          const atStart = index === 0;
          const atEnd = index + fmPaymentRef.length === bankRef.length;
          
          if (atStart || atEnd) {
            isValid = true;
            reason = fmMainRef.length >= 4 
              ? `paymentRef match (mainRef no match, pero paymentRef bien posicionado)`
              : 'paymentRef match (mainRef inválido)';
          } else {
            isValid = false;
            reason = 'paymentRef match pero mal posicionado (en medio)';
          }
        } else {
          isValid = false;
          reason = 'No hay referencia válida que haga match';
        }

        const status = isValid ? '✅' : '❌';
        console.log(`${status} Match #${i + 1}:`);
        console.log(`   FM: mainRef="${fmMainRef}" paymentRef="${fmPaymentRef}" amount=${fmTx.amount}`);
        console.log(`   Bank: ref="${bankRef}" amount=${bankTx.amount}`);
        console.log(`   Type: ${match.matchType}, Conf: ${match.confidence.toFixed(2)}, RefMatch: ${match.criteria?.referenceMatch}`);
        console.log(`   Validación: ${reason}`);
        if (!isValid) {
          console.log(`   ⚠️ Este match NO cumple las reglas`);
        }
        console.log('');
      }
    }

    await mongoose.disconnect();
    console.log('\n✅ Proceso completado');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

regenerateMatches();

