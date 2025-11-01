const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

async function findPotentialMatches() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Get sample transactions
    const fuerzaTxs = await Transaction.find({ type: 'fuerza_movil' })
      .limit(20)
      .sort({ date: -1 });

    const bankTxs = await Transaction.find({ type: 'bank' })
      .limit(20)
      .sort({ date: -1 });

    console.log('🔍 Buscando matches potenciales...\n');
    console.log('='.repeat(80));

    function cleanRef(ref) {
      return (ref || '').replace(/[^\d]/g, '');
    }

    // Buscar subcadenas del Bank en FM (todas las referencias)
    let potentialMatches = [];

    for (const bankTx of bankTxs) {
      const bankRef = cleanRef(bankTx.reference);
      if (bankRef.length < 4) continue;

      // Buscar en todas las referencias de FM
      for (const fmTx of fuerzaTxs) {
        const fmMainRef = cleanRef(fmTx.reference);
        const fmPaymentRef = cleanRef(fmTx.paymentReference);
        const fmInvoice = cleanRef(fmTx.invoiceNumber);

        // Verificar si alguna subcadena del Bank (mínimo 4 dígitos) está en FM
        // PRIORIDAD: Buscar primero las últimas 4-8 dígitos del Bank reference
        // (ej: si Bank es "17620079659201", buscar "9201", "59201", "659201", etc.)
        for (let len = Math.min(bankRef.length, 8); len >= 4; len--) {
          const bankSubstring = bankRef.slice(-len); // Últimos N dígitos del Bank
          
          // También probar sin leading zeros si el Bank tiene muchos
          const bankSubstringNoZeros = bankSubstring.replace(/^0+/, '');

          // Check in main ref (con y sin leading zeros)
          if (fmMainRef.length >= 4) {
            if (fmMainRef.includes(bankSubstring) || 
                (bankSubstringNoZeros.length >= 4 && fmMainRef.includes(bankSubstringNoZeros))) {
              const matched = fmMainRef.includes(bankSubstring) ? bankSubstring : bankSubstringNoZeros;
              potentialMatches.push({
                bankId: bankTx._id,
                bankRef: bankRef,
                bankSubstring: matched,
                fmId: fmTx._id,
                fmRef: fmMainRef,
                matchLocation: 'main_ref',
                matchLength: matched.length
              });
              break; // Solo el match más largo por transacción
            }
          }

          // Check in payment ref
          if (fmPaymentRef.length >= 4 && fmPaymentRef.includes(bankSubstring)) {
            potentialMatches.push({
              bankId: bankTx._id,
              bankRef: bankRef,
              bankSubstring: bankSubstring,
              fmId: fmTx._id,
              fmPaymentRef: fmPaymentRef,
              matchLocation: 'payment_ref',
              matchLength: len
            });
            break;
          }

          // Check in invoice (pero solo si main ref no existe o es inválida)
          if ((!fmMainRef || fmMainRef.length < 4) && fmInvoice.length >= 4 && fmInvoice.includes(bankSubstring)) {
            potentialMatches.push({
              bankId: bankTx._id,
              bankRef: bankRef,
              bankSubstring: bankSubstring,
              fmId: fmTx._id,
              fmInvoice: fmInvoice,
              matchLocation: 'invoice',
              matchLength: len
            });
            break;
          }
        }
      }
    }

    console.log(`\n📊 Encontrados ${potentialMatches.length} matches potenciales:\n`);

    potentialMatches.forEach((match, idx) => {
      console.log(`${idx + 1}. Bank Ref: "${match.bankRef}"`);
      console.log(`   Subcadena: "${match.bankSubstring}" (${match.matchLength} dígitos)`);
      console.log(`   FM ${match.matchLocation}: "${match.fmRef || match.fmPaymentRef || match.fmInvoice}"`);
      console.log(`   ✅ Match encontrado`);
      console.log('');
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

findPotentialMatches();

