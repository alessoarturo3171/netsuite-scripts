/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/error', 'N/log', 'N/query', 'N/record', 'N/search'],
    /**
 * @param{error} error
 * @param{log} log
 * @param{query} query
 * @param{record} record
 * @param{search} search
 */
    (error, log, query, record, search) => {
        /**
         * Defines the function that is executed when a GET request is sent to a RESTlet.
         * @param {Object} requestParams - Parameters from HTTP request URL; parameters passed as an Object (for all supported
         *     content types)
         * @returns {string | Object} HTTP response body; returns a string when request Content-Type is 'text/plain'; returns an
         *     Object when request Content-Type is 'application/json' or 'application/xml'
         * @since 2015.2
         */
        const get = (requestParams) => {
            const approvalLineSearch = search.create({
                type: 'customrecord_approvers',
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_listap_fieldparent.isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_subsidiary', 'anyof', 1],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_department', 'anyof', 6],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_employee', 'anyof', 14403],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_currency', 'anyof', 2],
                    'AND',
                    ['custrecord_listap_fieldparent.custrecord_appo_compra', 'anyof', 6]
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

            response = {
                success: true,
                data: []
            };

            for (const line of lines) {
                const level = line.getValue({ name: 'custrecord_listap_levelofapproval' });
                const approver = line.getValue({ name: 'custrecord_listap_approval' });
                const alternativeApprover = line.getValue({ name: 'custrecord_listap_alternativeapproval' });
                const startAmount = line.getValue({ name: 'custrecord_listap_startamount' });
                const endAmount = line.getValue({ name: 'custrecord_listap_endamount' });

                response.data.push({
                    level: level,
                    approver: approver,
                    alternativeApprover: alternativeApprover,
                    startAmount: startAmount,
                    endAmount: endAmount
                });
            }

            return response;

        }

        /**
         * Defines the function that is executed when a PUT request is sent to a RESTlet.
         * @param {string | Object} requestBody - The HTTP request body; request body are passed as a string when request
         *     Content-Type is 'text/plain' or parsed into an Object when request Content-Type is 'application/json' (in which case
         *     the body must be a valid JSON)
         * @returns {string | Object} HTTP response body; returns a string when request Content-Type is 'text/plain'; returns an
         *     Object when request Content-Type is 'application/json' or 'application/xml'
         * @since 2015.2
         */
        const put = (requestBody) => {

        }

        /**
         * Defines the function that is executed when a POST request is sent to a RESTlet.
         * @param {string | Object} requestBody - The HTTP request body; request body is passed as a string when request
         *     Content-Type is 'text/plain' or parsed into an Object when request Content-Type is 'application/json' (in which case
         *     the body must be a valid JSON)
         * @returns {string | Object} HTTP response body; returns a string when request Content-Type is 'text/plain'; returns an
         *     Object when request Content-Type is 'application/json' or 'application/xml'
         * @since 2015.2
         */
        const post = (requestBody) => {

        }

        /**
         * Defines the function that is executed when a DELETE request is sent to a RESTlet.
         * @param {Object} requestParams - Parameters from HTTP request URL; parameters are passed as an Object (for all supported
         *     content types)
         * @returns {string | Object} HTTP response body; returns a string when request Content-Type is 'text/plain'; returns an
         *     Object when request Content-Type is 'application/json' or 'application/xml'
         * @since 2015.2
         */
        const doDelete = (requestParams) => {

        }

        return { get, put, post, delete: doDelete }

    });
