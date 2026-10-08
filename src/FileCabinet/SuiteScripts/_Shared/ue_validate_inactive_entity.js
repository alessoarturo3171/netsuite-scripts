/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * 
 * Descripción: Valida que el cliente o proveedor asociado a la transacción no esté inactivo,
 * resolviendo transacciones origen (Transfer Orders / Sales Orders) cuando aplique.
 */
define(['N/search', 'N/error', 'N/log', 'N/runtime'], (search, error, log, runtime) => {

    // Transacciones que apuntan directamente a un Proveedor
    const VENDOR_TRANSACTIONS = new Set([
        'purchaseorder',
        'vendorbill',
        'vendorreturnauthorization',
        'vendorcredit'
    ]);

    // Transacciones que apuntan directamente a un Cliente
    const CUSTOMER_TRANSACTIONS = new Set([
        'salesorder',
        'invoice',
        'creditmemo',
        'returnauthorization'
    ]);

    /**
     * Consulta únicamente el estado 'isinactive' de una entidad usando 1 unidad de gobernanza
     */
    const isEntityInactive = (entityId, recordType) => {
        if (!entityId) return false;
        try {
            const lookup = search.lookupFields({
                type: recordType,
                id: entityId,
                columns: ['isinactive']
            });
            return lookup.isinactive === true || lookup.isinactive === 'T';
        } catch (e) {
            log.error('Error al consultar estado de entidad', { entityId, recordType, error: e.message });
            return false;
        }
    };

    /**
     * Obtiene el ID del cliente vinculado a través de una Orden de Venta referenciada en la Orden de Traslado
     */
    const getCustomerFromTransferOrder = (transferOrderId) => {
        if (!transferOrderId) return null;
        try {
            const toLookup = search.lookupFields({
                type: search.Type.TRANSFER_ORDER,
                id: transferOrderId,
                columns: ['custbody_sales_order_services']
            });

            const salesOrderId = toLookup.custbody_sales_order_services?.[0]?.value || toLookup.custbody_sales_order_services;
            if (!salesOrderId) return null;

            const soLookup = search.lookupFields({
                type: search.Type.SALES_ORDER,
                id: salesOrderId,
                columns: ['entity']
            });

            return soLookup.entity?.[0]?.value || soLookup.entity;
        } catch (e) {
            log.error('Error resolviendo cliente desde Transfer Order', { transferOrderId, error: e.message });
            return null;
        }
    };

    const beforeSubmit = (scriptContext) => {
        const { newRecord, type } = scriptContext;

        if (type !== scriptContext.UserEventType.CREATE && type !== scriptContext.UserEventType.EDIT) {
            return;
        }

        const recordType = newRecord.type;
        const executionContext = runtime.executionContext;

        /*
        // Lógica de actualización de precios en CSV Import (heredada de versión 1.0)
        if (type === scriptContext.UserEventType.CREATE && executionContext === runtime.ContextType.CSV_IMPORT) {
            if (recordType === 'salesorder' || recordType === 'estimate') {
                newRecord.setValue({ fieldId: 'custbodyautorizado_precios_up', value: true });
            }
        }*/

        let entityIdToCheck = null;
        let entityTypeToCheck = search.Type.CUSTOMER;
        let errorMessage = 'No es posible guardar la transacción: El cliente asignado se encuentra inactivo.';

        // 1. Transacciones directas de Proveedor
        if (VENDOR_TRANSACTIONS.has(recordType)) {
            entityIdToCheck = newRecord.getValue({ fieldId: 'entity' });
            entityTypeToCheck = search.Type.VENDOR;
            errorMessage = 'No es posible guardar la transacción: El proveedor asignado se encuentra inactivo.';
        }
        // 2. Transacciones directas de Cliente
        else if (CUSTOMER_TRANSACTIONS.has(recordType)) {
            entityIdToCheck = newRecord.getValue({ fieldId: 'entity' });
            entityTypeToCheck = search.Type.CUSTOMER;
        }
        // 3. Orden de Traslado (Transfer Order)
        else if (recordType === 'transferorder') {
            const salesOrderId = newRecord.getValue({ fieldId: 'custbody_sales_order_services' });
            if (salesOrderId) {
                const soLookup = search.lookupFields({
                    type: search.Type.SALES_ORDER,
                    id: salesOrderId,
                    columns: ['entity']
                });
                entityIdToCheck = soLookup.entity?.[0]?.value || soLookup.entity;
            }
        }
        // 4. Ejecución de Pedido (Item Fulfillment)
        else if (recordType === 'itemfulfillment') {
            const tipoOrdenTrabajo = newRecord.getValue({ fieldId: 'custbody_ov_tipvta' });
            const createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });

            if (tipoOrdenTrabajo && createdFrom) {
                // Viene directo de Sales Order
                const soLookup = search.lookupFields({
                    type: search.Type.SALES_ORDER,
                    id: createdFrom,
                    columns: ['entity']
                });
                entityIdToCheck = soLookup.entity?.[0]?.value || soLookup.entity;
            } else if (createdFrom) {
                // Viene de Transfer Order u otra transacción
                const billingType = newRecord.getValue({ fieldId: 'billingtype' });
                if (billingType !== 'VendCred') {
                    entityIdToCheck = getCustomerFromTransferOrder(createdFrom);
                }
            }
        }
        // 5. Recepción de Artículo (Item Receipt)
        else if (recordType === 'itemreceipt') {
            const rawEntity = newRecord.getValue({ fieldId: 'entity' });

            if (!rawEntity) {
                // Sin entity directa: viene de Transfer Order
                const createdFrom = newRecord.getValue({ fieldId: 'createdfrom' });
                entityIdToCheck = getCustomerFromTransferOrder(createdFrom);
            } else {
                const tipoOrdenTrabajo = newRecord.getValue({ fieldId: 'custbody_ov_tipvta' });
                const createdFromText = newRecord.getText({ fieldId: 'createdfrom' }) || '';
                const isReturnAuth = /(Return Authorization|Autorización de devolución)/i.test(createdFromText);

                if (!tipoOrdenTrabajo && !isReturnAuth) {
                    // Recepción de Orden de Compra (Proveedor)
                    entityIdToCheck = rawEntity;
                    entityTypeToCheck = search.Type.VENDOR;
                    errorMessage = 'No es posible guardar los cambios: El proveedor está inactivo.';
                } else {
                    // Recepción por Devolución (Cliente)
                    entityIdToCheck = rawEntity;
                    entityTypeToCheck = search.Type.CUSTOMER;
                }
            }
        }

        // Validación final
        if (entityIdToCheck && isEntityInactive(entityIdToCheck, entityTypeToCheck)) {
            throw error.create({
                name: 'INACTIVE_ENTITY_BLOCKED',
                message: errorMessage,
                notifyOff: false
            });
        }
    };

    return { beforeSubmit };
});