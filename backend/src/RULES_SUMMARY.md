# RESUMEN DE REGLAS DE MATCHING

## REGLA FUNDAMENTAL
**La referencia FM debe estar COMPLETAMENTE contenida como substring en la referencia Bank**

## PRIORIDAD DE REFERENCIAS

### 1. MAIN REFERENCE (Prioridad más alta)
- **Si mainRef existe y es válido (4+ dígitos)**: 
  - SOLO hacer match por mainRef
  - Si mainRef NO hace match → NO hacer match (no intentar paymentRef ni invoiceNumber)
  - Buscar en: bankRef primero, luego bankDescDigits
  - **NO buscar en bankAllDigits (combina ref + desc, causa falsos positivos)**

### 2. PAYMENT REFERENCE (Solo si mainRef inválido)
- **SOLO usar paymentRef si mainRef NO existe o es inválido (< 4 dígitos)**
- Si mainRef existe y es válido, NO usar paymentRef (previene falsos positivos)
- Buscar SOLO en bankRef (NO en descripciones - evita coincidencias con fechas/montos)
- Mínimo 4 dígitos

### 3. INVOICE NUMBER (Solo si mainRef inválido)
- **SOLO usar invoiceNumber si mainRef NO existe o es inválido (< 4 dígitos)**
- Si mainRef existe y es válido, NO usar invoiceNumber
- Buscar en: bankRef y bankDescDigits
- Usar `referencesMatchInvoiceInDesc` para validación estricta en descripciones

## MATCHING POR MONTO (Fase 2)
- **SOLO si NO hay referencia válida (mainRef < 4 dígitos)**
- Si FM tiene mainRef válido (4+ dígitos) → Skip amount matching
- Si Bank tiene referencia válida (4+ dígitos) → Skip amount matching
- Requiere que ambas transacciones NO tengan referencias válidas

## MATCHING POR DESCRIPCIÓN (Fase 3)
- **SOLO si NO hay referencia válida (ni mainRef ni paymentRef con 4+ dígitos)**
- Extraer dígitos correctamente para validar longitud
- Solo palabras clave simples (sin ML)

## VALIDACIÓN DE MONTO (después de match por referencia)
- **NO rechazar matches por diferencia de montos**
- Los montos solo afectan el confidence (bonus si son cercanos)
- La referencia es el criterio primario

## EJEMPLOS DE REGLAS

### ✅ CASO VÁLIDO 1: mainRef hace match
- FM mainRef: "0576", Bank ref: "00020576"
- Resultado: ✅ Match por mainRef

### ✅ CASO VÁLIDO 2: paymentRef hace match (mainRef inválido)
- FM mainRef: "123" (< 4 dígitos), FM paymentRef: "0576"
- Bank ref: "00020576"
- Resultado: ✅ Match por paymentRef

### ❌ CASO INVÁLIDO 1: mainRef no hace match, pero paymentRef sí (falso positivo)
- FM mainRef: "900823", FM paymentRef: "3559"
- Bank ref: "10355942"
- Análisis: mainRef existe y es válido pero no hace match → NO hacer match
- Resultado: ❌ No match (correcto)

### ❌ CASO INVÁLIDO 2: paymentRef en descripción (falso positivo)
- FM paymentRef: "000030"
- Bank ref: "29062792", Bank desc: "...30/06/2025..."
- Análisis: paymentRef aparece en descripción (fecha), no en ref → NO hacer match
- Resultado: ❌ No match (correcto)

