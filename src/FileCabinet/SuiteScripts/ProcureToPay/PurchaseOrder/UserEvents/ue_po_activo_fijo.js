/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/log'], (log) => {

    const ALESSO_FORM_ID = '127';
    const PURCHASE_TYPE_ASSET = '5';   
    const PURCHASE_TYPE_STANDARD = '3'; 

    const beforeSubmit = (scriptContext) => {
        const { type, UserEventType, newRecord } = scriptContext;

        if (type !== UserEventType.CREATE) {
            return;
        }

        const customForm = String(newRecord.getValue({ fieldId: 'customform' }));

        if (customForm !== ALESSO_FORM_ID) {
            return;
        }

        const lineCount = newRecord.getLineCount({ sublistId: 'item' });
        let hasFixedAsset = false;

        for (let i = 0; i < lineCount; i++) {
            const isAsset = newRecord.getSublistValue({
                sublistId: 'item',
                fieldId: 'custcol_oc_activofijo',
                line: i
            });

            if (isAsset === true || isAsset === 'T') {
                hasFixedAsset = true;
                break;
            }
        }

        const targetPurchaseType = hasFixedAsset ? PURCHASE_TYPE_ASSET : PURCHASE_TYPE_STANDARD;

        newRecord.setValue({
            fieldId: 'custbody_ov_com',
            value: targetPurchaseType
        });

        log.audit({
            title: 'Purchase Type Set',
            details: `PO clasificada exitosamente con custbody_ov_com = ${targetPurchaseType} (hasFixedAsset: ${hasFixedAsset})`
        });
    };

    return { beforeSubmit };
});