// ====================================================================
// XEP-0092: Software Version
// --------------------------------------------------------------------
// Source: https://xmpp.org/extensions/xep-0092.html
// Version: 1.1 (2007-02-15)
// ====================================================================

import { childText, DefinitionOptions } from '../jxt';

import { NS_VERSION } from '../Namespaces';

declare module './' {
    export interface IQPayload {
        softwareVersion?: SoftwareVersion;
    }
}

export interface SoftwareVersion {
    name?: string;
    version?: string;
    os?: string;
}

const Protocol: DefinitionOptions = {
    element: 'query',
    fields: {
        name: childText(null, 'name'),
        os: childText(null, 'os'),
        version: childText(null, 'version')
    },
    namespace: NS_VERSION,
    path: 'iq.softwareVersion'
};
export default Protocol;
