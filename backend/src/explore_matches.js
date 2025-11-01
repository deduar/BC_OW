const mongoose = require('mongoose');
const Match = require('./models/Match');
const Transaction = require('./models/Transaction');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

async function exploreMatches() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('EXPLORACIÓN DE MATCHES');
    console.log('='.repeat(80));
    console.log('');

    // Estadísticas generales
    const totalMatches = await Match.countDocuments({});
    console.log(`Total de matches: ${totalMatches}\n`);

    if (totalMatches === 0) {
      console.log('⚠️ No hay matches en la colección');
      await mongoose.disconnect();
      return;
    }

    // Obtener todos los matches
    const matches = await Match.find({})
      .sort({ createdAt: 1 })
      .lean();

    console.log('='.repeat(80));
    console.log('DETALLE DE MATCHES');
    console.log('='.repeat(80));
    console.log('');

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const fmTx = await Transaction.findById(match.fuerzaTransactionId);
      const bankTx = await Transaction.findById(match.bankTransactionId);

      if (!fmTx || !bankTx) {
        console.log(`⚠️ Match #${i + 1}: Transacción no encontrada`);
        continue;
      }

      const fmMainRef = (fmTx.reference || '').replace(/[^\d]/g, '');
      const fmPaymentRef = (fmTx.paymentReference || '').toString().replace(/[^\d]/g, '');
      const fmInvoiceNumber = (fmTx.invoiceNumber || '').replace(/[^\d]/g, '');
      const bankRef = (bankTx.reference || '').replace(/[^\d]/g, '');

      // Validación
      let isValid = false;
      let reason = '';

      if (fmMainRef.length >= 4 && bankRef.includes(fmMainRef)) {
        isValid = true;
        reason = `✅ mainRef "${fmMainRef}" está contenido en bankRef "${bankRef}"`;
      } else if (fmPaymentRef.length >= 4 && bankRef.includes(fmPaymentRef)) {
        // Check if paymentRef is well-positioned (start or end)
        const index = bankRef.indexOf(fmPaymentRef);
        const atStart = index === 0;
        const atEnd = index + fmPaymentRef.length === bankRef.length;
        
        if (atStart || atEnd) {
          isValid = true;
          reason = fmMainRef.length >= 4
            ? `✅ paymentRef "${fmPaymentRef}" está en bankRef "${bankRef}" (mainRef no match, pero paymentRef bien posicionado)`
            : `✅ paymentRef "${fmPaymentRef}" está en bankRef "${bankRef}" (mainRef inválido)`;
        } else {
          isValid = false;
          reason = `❌ paymentRef "${fmPaymentRef}" está en bankRef "${bankRef}" pero mal posicionado (en medio)`;
        }
      } else {
        isValid = false;
        reason = '❌ No hay referencia válida que haga match';
      }

      console.log(`Match #${i + 1}:`);
      console.log(`  ID: ${match._id}`);
      console.log(`  Created: ${match.createdAt || 'N/A'}`);
      console.log('');
      console.log(`  FUERZA MÓVIL:`);
      console.log(`    Reference: "${fmTx.reference}" (cleaned: "${fmMainRef}")`);
      console.log(`    PaymentRef: "${fmTx.paymentReference || 'N/A'}" (cleaned: "${fmPaymentRef}")`);
      console.log(`    InvoiceNumber: "${fmTx.invoiceNumber || 'N/A'}" (cleaned: "${fmInvoiceNumber}")`);
      console.log(`    Amount: ${fmTx.amount}`);
      console.log(`    PaidAmount: ${fmTx.paidAmount || 'N/A'}`);
      console.log(`    Description: ${(fmTx.description || '').substring(0, 60)}...`);
      console.log(`    Date: ${fmTx.date}`);
      console.log('');
      console.log(`  BANCO:`);
      console.log(`    Reference: "${bankTx.reference}" (cleaned: "${bankRef}")`);
      console.log(`    Amount: ${bankTx.amount}`);
      console.log(`    Description: ${(bankTx.description || '').substring(0, 80)}...`);
      console.log(`    Date: ${bankTx.date}`);
      console.log('');
      console.log(`  MATCH INFO:`);
      console.log(`    Type: ${match.matchType}`);
      console.log(`    Confidence: ${match.confidence.toFixed(3)}`);
      console.log(`    ReferenceMatch: ${match.criteria?.referenceMatch || 'N/A'}`);
      console.log(`    MatchLocation: ${match.criteria?.matchLocation || 'N/A'}`);
      console.log(`    AmountMatch: ${match.criteria?.amountMatch || false}`);
      console.log(`    DateMatch: ${match.criteria?.dateMatch || false}`);
      console.log(`    AmountDifference: ${match.amountDifference ? match.amountDifference.toFixed(3) : 'N/A'}`);
      console.log(`    DateDifference: ${match.dateDifference ? match.dateDifference.toFixed(1) + ' days' : 'N/A'}`);
      console.log('');
      console.log(`  VALIDACIÓN: ${reason}`);
      if (!isValid) {
        console.log(`  ⚠️ Este match NO cumple las reglas establecidas`);
      }
      console.log('');
      console.log('-' .repeat(80));
      console.log('');
    }

    // Resumen de validación
    console.log('='.repeat(80));
    console.log('RESUMEN DE VALIDACIÓN');
    console.log('='.repeat(80));
    console.log('');

    let validCount = 0;
    let invalidCount = 0;

    for (const match of matches) {
      const fmTx = await Transaction.findById(match.fuerzaTransactionId);
      const bankTx = await Transaction.findById(match.bankTransactionId);

      if (fmTx && bankTx) {
        const fmMainRef = (fmTx.reference || '').replace(/[^\d]/g, '');
        const fmPaymentRef = (fmTx.paymentReference || '').toString().replace(/[^\d]/g, '');
        const bankRef = (bankTx.reference || '').replace(/[^\d]/g, '');

        let isValid = false;
        if (fmMainRef.length >= 4 && bankRef.includes(fmMainRef)) {
          isValid = true;
        } else if (fmPaymentRef.length >= 4 && fmMainRef.length < 4 && bankRef.includes(fmPaymentRef)) {
          isValid = true;
        }

        if (isValid) validCount++;
        else invalidCount++;
      }
    }

    console.log(`Matches válidos: ${validCount} ✅`);
    console.log(`Matches inválidos: ${invalidCount} ${invalidCount > 0 ? '❌' : ''}`);
    console.log(`Total: ${totalMatches}`);
    console.log(`Porcentaje válido: ${((validCount / totalMatches) * 100).toFixed(1)}%`);

    await mongoose.disconnect();
    console.log('\n✅ Desconectado de MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

exploreMatches();

