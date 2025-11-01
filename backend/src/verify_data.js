const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/bank_reconciliation';

async function verifyData() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB\n');
    console.log('='.repeat(80));
    console.log('VERIFICACIÓN DE DATOS EN BASE DE DATOS');
    console.log('='.repeat(80));

    // Buscar la transacción específica del ejemplo
    // FM: 802276 con paymentReference 0576
    const fmTx = await Transaction.findOne({
      type: 'fuerza_movil',
      reference: /802276/,
      paymentReference: /0576/
    });

    if (fmTx) {
      console.log('\n✅ Transacción FM encontrada:');
      console.log(`  ID: ${fmTx._id}`);
      console.log(`  Reference: "${fmTx.reference}"`);
      console.log(`  PaymentReference: "${fmTx.paymentReference}"`);
      console.log(`  InvoiceNumber: "${fmTx.invoiceNumber}"`);
      console.log(`  ClientName: "${fmTx.clientName}"`);
      console.log(`  Amount: ${fmTx.amount}`);
      console.log(`  PaidAmount: ${fmTx.paidAmount}`);
    } else {
      console.log('\n⚠️ No se encontró la transacción FM específica');
      console.log('Buscando transacciones FM con paymentReference...\n');
      
      const fmTxsWithPaymentRef = await Transaction.find({
        type: 'fuerza_movil',
        paymentReference: { $exists: true, $ne: '' }
      }).limit(10);

      console.log(`Encontradas ${fmTxsWithPaymentRef.length} transacciones FM con paymentReference:\n`);
      fmTxsWithPaymentRef.forEach((tx, idx) => {
        console.log(`${idx + 1}. Reference: "${tx.reference}"`);
        console.log(`   PaymentReference: "${tx.paymentReference}"`);
        console.log(`   InvoiceNumber: "${tx.invoiceNumber}"`);
        console.log('');
      });
    }

    // Buscar transacciones bancarias con referencia 00020576
    const bankTx = await Transaction.findOne({
      type: 'bank',
      reference: /00020576|0020576|20576/
    });

    if (bankTx) {
      console.log('\n✅ Transacción Bank encontrada:');
      console.log(`  ID: ${bankTx._id}`);
      console.log(`  Reference: "${bankTx.reference}"`);
      console.log(`  Description: "${bankTx.description?.substring(0, 100)}..."`);
      console.log(`  Amount: ${bankTx.amount}`);
    } else {
      console.log('\n⚠️ No se encontró la transacción Bank específica');
      console.log('Buscando transacciones Bank con referencias similares...\n');
      
      const bankTxs = await Transaction.find({
        type: 'bank',
        reference: /20576|0576/
      }).limit(10);

      console.log(`Encontradas ${bankTxs.length} transacciones Bank:\n`);
      bankTxs.forEach((tx, idx) => {
        console.log(`${idx + 1}. Reference: "${tx.reference}"`);
        console.log(`   Description: "${tx.description?.substring(0, 80)}..."`);
        console.log('');
      });
    }

    // Verificar estructura general
    console.log('\n' + '='.repeat(80));
    console.log('ESTADÍSTICAS GENERALES');
    console.log('='.repeat(80));
    
    const totalFM = await Transaction.countDocuments({ type: 'fuerza_movil' });
    const totalBank = await Transaction.countDocuments({ type: 'bank' });
    const fmWithPaymentRef = await Transaction.countDocuments({
      type: 'fuerza_movil',
      paymentReference: { $exists: true, $ne: '' }
    });
    const fmWithInvoice = await Transaction.countDocuments({
      type: 'fuerza_movil',
      invoiceNumber: { $exists: true, $ne: '' }
    });

    console.log(`\nTotal FM transactions: ${totalFM}`);
    console.log(`FM con paymentReference: ${fmWithPaymentRef} (${(fmWithPaymentRef/totalFM*100).toFixed(1)}%)`);
    console.log(`FM con invoiceNumber: ${fmWithInvoice} (${(fmWithInvoice/totalFM*100).toFixed(1)}%)`);
    console.log(`Total Bank transactions: ${totalBank}`);

    // Sample de referencias
    console.log('\n' + '='.repeat(80));
    console.log('MUESTRAS DE REFERENCIAS');
    console.log('='.repeat(80));
    
    const sampleFM = await Transaction.find({ type: 'fuerza_movil' })
      .limit(5)
      .select('reference paymentReference invoiceNumber');
    
    console.log('\nSample FM references:');
    sampleFM.forEach((tx, idx) => {
      console.log(`${idx + 1}. Reference: "${tx.reference || 'N/A'}"`);
      console.log(`   PaymentRef: "${tx.paymentReference || 'N/A'}"`);
      console.log(`   Invoice: "${tx.invoiceNumber || 'N/A'}"`);
      console.log('');
    });

    const sampleBank = await Transaction.find({ type: 'bank' })
      .limit(5)
      .select('reference description');
    
    console.log('\nSample Bank references:');
    sampleBank.forEach((tx, idx) => {
      console.log(`${idx + 1}. Reference: "${tx.reference || 'N/A'}"`);
      console.log(`   Description (first 60 chars): "${tx.description?.substring(0, 60) || 'N/A'}..."`);
      console.log('');
    });

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verifyData();

