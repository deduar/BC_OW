const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');
const Match = require('./models/Match');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

async function findPotentialMatches() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('BÚSQUEDA DE MATCHES POTENCIALES');
    console.log('='.repeat(80));
    console.log('');

    // Obtener todas las transacciones
    const fuerzaTxs = await Transaction.find({ type: 'fuerza_movil' })
      .limit(50) // Empezar con las primeras 50 para análisis
      .lean();
    
    const bankTxs = await Transaction.find({ type: 'bank' }).lean();

    console.log(`Analizando ${fuerzaTxs.length} transacciones FM contra ${bankTxs.length} transacciones Bank\n`);

    // Obtener matches existentes
    const existingMatches = await Match.find({}).lean();
    const matchedFuerzaIds = new Set(existingMatches.map(m => m.fuerzaTransactionId.toString()));
    const matchedBankIds = new Set(existingMatches.map(m => m.bankTransactionId.toString()));

    let potentialMatches = [];

    for (const fmTx of fuerzaTxs) {
      if (matchedFuerzaIds.has(fmTx._id.toString())) continue;

      const fmMainRef = (fmTx.reference || '').replace(/[^\d]/g, '');
      const fmPaymentRef = (fmTx.paymentReference || '').toString().replace(/[^\d]/g, '');
      
      if (fmMainRef.length < 4 && fmPaymentRef.length < 4) continue; // Sin referencia válida

      for (const bankTx of bankTxs) {
        if (matchedBankIds.has(bankTx._id.toString())) continue;

        const bankRef = (bankTx.reference || '').replace(/[^\d]/g, '');
        const bankDescDigits = (bankTx.description || '').replace(/[^\d]/g, '');

        if (bankRef.length < 4) continue;

        // Verificar matches potenciales
        let matchReason = '';
        let isPotentialMatch = false;

        // Caso 1: mainRef en bankRef
        if (fmMainRef.length >= 4 && bankRef.includes(fmMainRef)) {
          isPotentialMatch = true;
          matchReason = `mainRef "${fmMainRef}" en bankRef "${bankRef}"`;
        }
        // Caso 2: mainRef en bankDesc (pero actualmente no lo buscamos)
        else if (fmMainRef.length >= 4 && bankDescDigits.includes(fmMainRef)) {
          isPotentialMatch = true;
          matchReason = `mainRef "${fmMainRef}" en bankDesc (actualmente bloqueado)`;
        }
        // Caso 3: paymentRef en bankRef (si mainRef inválido)
        else if (fmMainRef.length < 4 && fmPaymentRef.length >= 4 && bankRef.includes(fmPaymentRef)) {
          isPotentialMatch = true;
          matchReason = `paymentRef "${fmPaymentRef}" en bankRef "${bankRef}" (mainRef inválido)`;
        }

        if (isPotentialMatch) {
          const fuerzaAmount = fmTx.paidAmount || fmTx.amount || 0;
          const bankAmount = Math.abs(bankTx.amount || 0);
          const amountDiff = fuerzaAmount > 0 && bankAmount > 0 ? Math.abs(fuerzaAmount - bankAmount) : null;

          potentialMatches.push({
            fmTx,
            bankTx,
            fmMainRef,
            fmPaymentRef,
            bankRef,
            matchReason,
            amountDiff,
            fuerzaAmount,
            bankAmount
          });
        }
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`MATCHES POTENCIALES ENCONTRADOS: ${potentialMatches.length}`);
    console.log('='.repeat(80));
    console.log('');

    // Mostrar los primeros 20
    for (let i = 0; i < Math.min(potentialMatches.length, 20); i++) {
      const pm = potentialMatches[i];
      console.log(`\n${i + 1}. ${pm.matchReason}`);
      console.log(`   FM: ref="${pm.fmTx.reference}" paymentRef="${pm.fmTx.paymentReference || 'N/A'}" amount=${pm.fuerzaAmount}`);
      console.log(`   Bank: ref="${pm.bankTx.reference}" amount=${pm.bankAmount}`);
      if (pm.amountDiff !== null) {
        console.log(`   Amount diff: ${pm.amountDiff.toFixed(2)}`);
      }
      if (pm.matchReason.includes('bankDesc')) {
        console.log(`   ⚠️ Este match está siendo bloqueado porque buscamos solo en bankRef`);
      }
    }

    // Estadísticas
    const blockedByDescRule = potentialMatches.filter(pm => pm.matchReason.includes('bankDesc')).length;
    console.log(`\n${'='.repeat(80)}`);
    console.log('ESTADÍSTICAS');
    console.log('='.repeat(80));
    console.log(`Total potencial: ${potentialMatches.length}`);
    console.log(`Bloqueados por regla de descripción: ${blockedByDescRule}`);
    console.log(`Que deberían hacer match: ${potentialMatches.length - blockedByDescRule}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

findPotentialMatches();

