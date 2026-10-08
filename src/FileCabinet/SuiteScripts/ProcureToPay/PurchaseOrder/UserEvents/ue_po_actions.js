/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error', 'N/log', 'N/record', 'N/search', 'N/runtime'],
    /**
 * @param{error} error
 * @param{log} log
 * @param{record} record
 * @param{search} search
 * @param{runtime} runtime
 */
    (error, log, record, search, runtime) => {
        /**
         * Defines the function definition that is executed before record is loaded.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @param {Form} scriptContext.form - Current form
         * @param {ServletRequest} scriptContext.request - HTTP request information sent from the browser for a client action only.
         * @since 2015.2
         */
        const beforeLoad = (scriptContext) => {
            const { type, UserEventType, newRecord, form } = scriptContext;

            if(type == UserEventType.EDIT) {
                let approvalStatus = newRecord.getValue({ fieldId: 'approvalstatus' });
                if(approvalStatus == 2) {
                    form.addButton({
                        id: 'custpage_mark',
                        label: 'Marcar todos',
                        functionName: 'markAllLines()'
                    });
                    form.addButton({
                        id: 'custpage_unmark',
                        label: 'Desmarcar todos',
                        functionName: 'unmarkAllLines()'
                    });

                    form.clientScriptModulePath = '../ClientScripts/cs_po_buttons_actions.js';
                }
            }

            if (type === UserEventType.VIEW) {
                let user = runtime.getCurrentUser();
                let userId = user.id;
                let rol = user.role;
                let subsidiary = newRecord.getValue({ fieldId: 'subsidiary' });
                let department = newRecord.getValue({ fieldId: 'department' });
                let applicant = newRecord.getValue({ fieldId: 'employee' });
                let level = newRecord.getValue({ fieldId: 'custbody_approval_level' });
                let total = newRecord.getValue({ fieldId: 'total' });
                let currency = newRecord.getValue({ fieldId: 'currency' });
                let approvalStatus = newRecord.getValue({ fieldId: 'approvalstatus' });
                let purchaseType = newRecord.getValue({ fieldId: 'custbody_ov_com' });
                let nextApprover = newRecord.getValue({ fieldId: 'nextapprover' });
                let nextApproverAlt = newRecord.getValue({ fieldId: 'custbody_nextapproval_alternative' });

                if (purchaseType) {
                    form.clientScriptModulePath = '../ClientScripts/cs_po_buttons_actions.js';

                    if ((userId == nextApprover || userId == nextApproverAlt) && approvalStatus == 1) {
                        form.addButton({
                            id: 'custpage_btnapproval',
                            label: 'Aprobar',
                            functionName: `approvePO(${subsidiary}, ${department}, ${applicant}, ${level}, ${total}, '${currency}', ${purchaseType})`
                        });
                        form.addButton({
                            id: 'custpage_reject',
                            label: 'Rechazar',
                            functionName: 'rejectPO'
                        });
                    }
                }
            }
        }

        /**
         * Defines the function definition that is executed before record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const beforeSubmit = (scriptContext) => {
            const { newRecord, oldRecord, type, UserEventType } = scriptContext;

            if (type !== UserEventType.CREATE && type !== UserEventType.EDIT) {
                return;
            }

            const purchaseType = newRecord.getValue({ fieldId: 'custbody_ov_com' });
            if (!purchaseType) return;

            // 1. Detección de cambios de total en EDIT (0 unidades de gobernanza usando oldRecord)
            if (type === UserEventType.EDIT && oldRecord) {
                const oldTotal = parseFloat(oldRecord.getValue({ fieldId: 'total' })) || 0;
                const newTotal = parseFloat(newRecord.getValue({ fieldId: 'total' })) || 0;

                if (oldTotal !== newTotal) {
                    log.audit('Reinicio de Aprobación', `El monto cambió de ${oldTotal} a ${newTotal}. Reiniciando matriz.`);
                    newRecord.setValue({ fieldId: 'approvalstatus', value: 1 }); // 1 = Pendiente de Aprobación
                    newRecord.setValue({ fieldId: 'nextapprover', value: '' });
                    newRecord.setValue({ fieldId: 'custbody_nextapproval_alternative', value: '' });
                    newRecord.setValue({ fieldId: 'custbody_approval_level', value: 1 });
                }
            }

            // 2. Validación de condiciones para detonar la asignación de nivel 1
            const levelApp = Number(newRecord.getValue({ fieldId: 'custbody_approval_level' })) || 0;
            const nextApprover = newRecord.getValue({ fieldId: 'nextapprover' });
            const requiresAssignment = levelApp === 1 && (!nextApprover || nextApprover === '-1' || nextApprover === -1);

            if (!requiresAssignment) {
                return;
            }

            // 3. Extracción de valores de cabecera
            const subsidiary = newRecord.getValue({ fieldId: 'subsidiary' });
            const department = newRecord.getValue({ fieldId: 'department' });
            const applicant = newRecord.getValue({ fieldId: 'employee' });
            const currency = newRecord.getValue({ fieldId: 'currency' });
            const total = parseFloat(newRecord.getValue({ fieldId: 'total' })) || 0;

            try {
                const rule = searchListApprover(
                    subsidiary,
                    department,
                    applicant,
                    currency,
                    purchaseType,
                    total
                );

                log.debug('Matriz de aprobación encontrada', { rule });

                if (!rule) {
                    throw error.create({
                        name: 'MATRIX_ERROR',
                        message: 'NO Existe matriz de aprobación creada, revisar Configuración > Personalizado > Aprobación compras.',
                        notifyOff: false
                    });
                }

                if (rule.approver) {
                    newRecord.setValue({ fieldId: 'nextapprover', value: rule.approver });
                }
                if (rule.approverAlt) {
                    newRecord.setValue({ fieldId: 'custbody_nextapproval_alternative', value: rule.approverAlt });
                }
                newRecord.setValue({ fieldId: 'custbody_approval_level', value: rule.level });

            } catch (e) {
                log.error('Error al evaluar matriz de aprobación', { error: e.message });
                throw e;
            }
        };

        /**
         * Defines the function definition that is executed after record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const afterSubmit = (scriptContext) => {

        }

        /**
         * Function to search for the next approver based on subsidiary, department, applicant, level, currency, and purchase type.
         * @param {number} subsidiary - The subsidiary ID
         * @param {number} department - The department ID
         * @param {number} applicant - The applicant (employee) ID
         * @param {string} currency - The currency code
         * @param {string} purchaseType - The purchase type
         * @param {number} total - The purchase order total
         */
        const searchListApprover = (p_subsidiary, p_department, p_applicant, p_currency, p_purchaseType, p_total) => {
            log.debug('searchListApprover', { p_subsidiary, p_department, p_applicant, p_currency, p_purchaseType, p_total });
            let cleanSubsidiary = cleanIds(p_subsidiary);
            let cleanDepartment = cleanIds(p_department);
            let cleanApplicant = cleanIds(p_applicant);
            let cleanCurrency = cleanIds(p_currency);
            let cleanPurchaseType = cleanIds(p_purchaseType);
            
            log.debug('Valores limpios', { cleanSubsidiary, cleanDepartment, cleanApplicant, cleanCurrency, cleanPurchaseType });
            const approvalLineSearch = search.create({
                type: 'customrecord_approvers',
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_listap_fieldparent.isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_subsidiary', 'anyof', cleanSubsidiary],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_department', 'anyof', cleanDepartment],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_employee', 'anyof', cleanApplicant],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_currency', 'anyof', cleanCurrency],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_compra', 'anyof', cleanPurchaseType]
                ],
                columns: [
                    search.createColumn({ name: 'custrecord_listap_levelofapproval', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'custrecord_listap_approval' }),
                    search.createColumn({ name: 'custrecord_listap_alternativeapproval' }),
                    search.createColumn({ name: 'custrecord_listap_startamount' }),
                    search.createColumn({ name: 'custrecord_listap_endamount' })
                ]
            });


            const lines = approvalLineSearch.run().getRange({ start: 0, end: 50 });
            if (!lines || lines.length === 0) return null;

            log.debug('Matriz de aprobación encontrada', { lines });

            for (const line of lines) {
                const approver = line.getValue({ name: 'custrecord_listap_approval' });
                const approverAlt = line.getValue({ name: 'custrecord_listap_alternativeapproval' });
                const level = line.getValue({ name: 'custrecord_listap_levelofapproval' });
                const startRaw = line.getValue({ name: 'custrecord_listap_startamount' });
                const endRaw = line.getValue({ name: 'custrecord_listap_endamount' });

                const hasAmounts = startRaw !== '' && startRaw !== null && endRaw !== '' && endRaw !== null;

                if (hasAmounts) {
                    const startAmt = parseFloat(startRaw) || 0;
                    const endAmt = parseFloat(endRaw) || 0;

                    if (p_total >= startAmt && p_total <= endAmt) {
                        return { approver, approverAlt, level };
                    }
                } else {
                    return { approver, approverAlt, level };
                }
            }

            return null;

        }

        const cleanIds = (id) => {
            if (!id || id === '' || id === '-1' || id === -1) return null;
            const parsed = parseInt(id, 10);
            return isNaN(parsed) ? null : parsed;
        }

        return { beforeLoad, beforeSubmit, afterSubmit }

    });
