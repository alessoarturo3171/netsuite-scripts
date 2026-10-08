/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/ui/dialog', 'N/currentRecord', 'N/url', 'N/https'],
    (record, search, dialog, currentRecord, url, https) => {

        /**
         * Acción del Botón Aprobar
         */
        const approvePO = (subsidiary, department, applicant, currentLevel, total, currency, purchaseType) => {
            const poId = currentRecord.get().id;

            dialog.confirm({
                title: 'Confirmar Aprobación',
                message: '¿Está seguro de que desea aprobar esta Orden de Compra?'
            }).then((confirmed) => {
                if (!confirmed) return;

                const result = getNextApprovalLine({
                    subsidiary,
                    department,
                    applicant,
                    currency,
                    purchaseType,
                    currentLevel,
                    total: parseFloat(total) || 0
                });
                console.log('Resultado de la evaluación de reglas de aprobación:', result);
                // 1. Escenario de Error: Matriz no encontrada
                if (result.status === 'NO_RULES') {
                    dialog.alert({
                        title: 'Error de Matriz',
                        message: 'No existe una matriz de aprobación configurada para esta transacción o el rango de montos es inválido. La orden no puede ser aprobada.'
                    });
                    return;
                }

                // 2. Escenario Final: Completó todos los niveles requeridos
                if (result.status === 'COMPLETED') {
                    record.submitFields({
                        type: record.Type.PURCHASE_ORDER,
                        id: poId,
                        values: {
                            approvalstatus: 2, // Aprobada
                            nextapprover: '',
                            custbody_nextapproval_alternative: ''
                        }
                    });
                    window.location.reload();
                    return;
                }

                // 3. Escenario Intermedio: Pasa al siguiente aprobador
                if (result.status === 'ADVANCE') {
                    record.submitFields({
                        type: record.Type.PURCHASE_ORDER,
                        id: poId,
                        values: {
                            approvalstatus: 1, // Pendiente de Aprobación
                            nextapprover: result.data.approver,
                            custbody_approval_level: result.data.level,
                            custbody_nextapproval_alternative: result.data.approverAlt || ''
                        }
                    });
                    window.location.reload();
                }
            }).catch((e) => {
                dialog.alert({ title: 'Error', message: e.message });
            });
        };

        /**
         * Acción del Botón Rechazar
         */
        const rejectPO = () => {
            const poId = currentRecord.get().id;

            dialog.confirm({
                title: 'Confirmar Rechazo',
                message: '¿Está seguro de que desea rechazar esta Orden de Compra?'
            }).then((confirmed) => {
                if (!confirmed) return;

                // Actualiza estatus a Rechazada (3)
                record.submitFields({
                    type: record.Type.PURCHASE_ORDER,
                    id: poId,
                    values: {
                        approvalstatus: 3, // Rechazada
                        nextapprover: '',
                        custbody_nextapproval_alternative: ''
                    }
                });

                window.location.reload();
            }).catch((e) => {
                dialog.alert({ title: 'Error', message: e.message });
            });
        };

        /**
         * Acción del botón de marcar todas las líneas
         */
        const markAllLines = () => {
            console.log('markAllLines function invoked');
            setAllLinesChecked(true);

        }

        /**
         * Acción del botón de desmarcar todas las líneas
         */
        const unmarkAllLines = () => {
            console.log('unmarkAllLines function invoked');
            setAllLinesChecked(false);
        };

        /**
        * Evalúa las reglas de aprobación distinguiendo si la matriz existe y si quedan niveles pendientes
        * @returns {Object} { status: 'ADVANCE' | 'COMPLETED' | 'NO_RULES', data?: Object }
        */
        const getNextApprovalLine = ({ subsidiary, department, applicant, currency, purchaseType, currentLevel, total }) => {
            const nextLevelTarget = (parseInt(currentLevel, 10) || 0) + 1;

            const approvalLineSearch = search.create({
                type: 'customrecord_approvers',
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_listap_fieldparent.isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_subsidiary', 'anyof', subsidiary],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_department', 'anyof', department],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_employee', 'anyof', applicant],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_currency', 'anyof', currency],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_compra', 'anyof', purchaseType]
                ],
                columns: [
                    'custrecord_listap_levelofapproval',
                    'custrecord_listap_approval',
                    'custrecord_listap_alternativeapproval',
                    'custrecord_listap_startamount',
                    'custrecord_listap_endamount'
                ]
            });

            const lines = approvalLineSearch.run().getRange({ start: 0, end: 50 });

            // CASO 1: No existe ninguna configuración para los parámetros dados
            if (!lines || lines.length === 0) {
                return { status: 'NO_RULES' };
            }

            const parsedLines = lines.map(line => {
                const levelText = line.getText({ name: 'custrecord_listap_levelofapproval' }) || '';
                const levelValue = line.getValue({ name: 'custrecord_listap_levelofapproval' });
                const numericLevel = parseInt(levelText.replace(/\D/g, ''), 10) || parseInt(levelValue, 10) || 0;

                const startRaw = line.getValue({ name: 'custrecord_listap_startamount' });
                const endRaw = line.getValue({ name: 'custrecord_listap_endamount' });

                return {
                    levelValue: levelValue,
                    numericLevel: numericLevel,
                    approver: line.getValue({ name: 'custrecord_listap_approval' }),
                    approverAlt: line.getValue({ name: 'custrecord_listap_alternativeapproval' }),
                    startAmt: parseFloat(startRaw) || 0,
                    endAmt: parseFloat(endRaw) || 0,
                    hasAmounts: startRaw !== '' && startRaw !== null && endRaw !== '' && endRaw !== null
                };
            });

            console.log('Parsed approval lines:', parsedLines);
            debugger;

            parsedLines.sort((a, b) => a.numericLevel - b.numericLevel);

            // Buscar si existe un nivel posterior aplicable
            for (const line of parsedLines) {
                if (line.numericLevel >= nextLevelTarget) {
                    if (line.hasAmounts) {
                        if (total >= line.startAmt && total <= line.endAmt) {
                            return {
                                status: 'ADVANCE',
                                data: {
                                    approver: line.approver,
                                    approverAlt: line.approverAlt,
                                    level: line.levelValue
                                }
                            };
                        }
                    } else {
                        return {
                            status: 'ADVANCE',
                            data: {
                                approver: line.approver,
                                approverAlt: line.approverAlt,
                                level: line.levelValue
                            }
                        };
                    }
                }
            }

            // CASO 2: La matriz existe, pero ya no hay más niveles mayores -> Aprobación Completa
            return { status: 'COMPLETED' };
        };

        /** 
         * Función genérica para marcar/desmarcar todas las líneas de un sublist.
         * @param {boolean} checkValue - true para marcar, false para desmarcar.
         */
        const setAllLinesChecked = (checkValue) => {
            const currentRec = currentRecord.get();
            const lineCount = currentRec.getLineCount({ sublistId: 'item' });
            const currentIndex = currentRec.getCurrentSublistIndex({ sublistId: 'item' });

            if(currentIndex < lineCount ) {
                dialog.alert({
                    title: 'Error',
                    message: 'Por favor, asegúrese de no tener ninguna línea en edición antes de marcar o desmarcar todas las líneas.'
                });
                return;
            }

            for (let i = 0; i < lineCount; i++) {
                currentRec.selectLine({ sublistId: 'item', line: i });
                currentRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_apply',
                    value: checkValue,
                    ignoreFieldChange: true
                });
                currentRec.commitLine({ sublistId: 'item' });
            }
        };



        // Declaración en ventana para invocación desde form.addButton en modo VIEW
        window.approvePO = approvePO;
        window.rejectPO = rejectPO;

        return {
            pageInit: () => {},
            approvePO,
            rejectPO,
            markAllLines,
            unmarkAllLines
        };
    });