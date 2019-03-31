import { NS_JINGLE_ICE_UDP_1, NS_JINGLE_RTP_1 } from '../../protocol';

import * as SDP from './SDP';

import {
    IntermediateCandidate,
    IntermediateMediaDescription,
    IntermediateSessionDescription
} from './Intermediate';

import { directionToSenders, sendersToDirection, SessionRole } from './JingleUtil';

import {
    Jingle,
    JingleContent,
    JingleContentGroup,
    JingleIceUdp,
    JingleIceUdpCandidate,
    JingleRtpCodec,
    JingleRtpDescription
} from '../../protocol/stanzas';

export function convertIntermediateToApplication(
    media: IntermediateMediaDescription,
    role: SessionRole
): JingleRtpDescription {
    const rtp = media.rtpParameters!;
    const rtcp = media.rtcpParameters || {};
    const encodingParameters = media.rtpEncodingParameters || [];

    let hasSSRC = false;
    if (encodingParameters && encodingParameters.length) {
        hasSSRC = !!encodingParameters[0].ssrc; // !== false ???
    }

    const application: JingleRtpDescription = {
        applicationType: NS_JINGLE_RTP_1,
        codecs: [],
        headerExtensions: [],
        media: media.kind as 'audio' | 'video',
        rtcpMux: rtcp.mux,
        rtcpReducedSize: rtcp.reducedSize,
        sourceGroups: [],
        sources: [],
        ssrc: hasSSRC ? encodingParameters[0].ssrc.toString() : undefined,
        streams: []
    };

    for (const ext of rtp.headerExtensions || []) {
        application.headerExtensions!.push({
            id: ext.id,
            senders:
                ext.direction && ext.direction !== 'sendrecv'
                    ? directionToSenders(role, ext.direction)
                    : undefined,
            uri: ext.uri
        });
    }

    if (rtcp.ssrc && rtcp.cname) {
        application.sources = [
            {
                parameters: {
                    cname: rtcp.cname
                },
                ssrc: rtcp.ssrc.toString()
            }
        ];
    }

    if (hasSSRC && encodingParameters[0] && encodingParameters[0].rtx) {
        application.sourceGroups = [
            {
                semantics: 'FID',
                sources: [
                    encodingParameters[0].ssrc.toString(),
                    encodingParameters[0].rtx.ssrc.toString()
                ]
            }
        ];
    }

    for (const stream of media.streams || []) {
        application.streams!.push({
            id: stream.stream,
            track: stream.track
        });
    }

    for (const codec of rtp.codecs || []) {
        const payload: JingleRtpCodec = {
            channels: codec.channels,
            clockRate: codec.clockRate,
            id: codec.payloadType.toString(),
            maxptime: codec.maxptime ? codec.maxptime.toString() : undefined,
            name: codec.name,
            parameters: codec.parameters,
            rtcpFeedback: codec.rtcpFeedback
        };

        for (const key of Object.keys(codec.parameters || {})) {
            if (key === 'ptime') {
                payload.ptime = codec.parameters![key].toString();
                continue;
            }
        }

        application.codecs!.push(payload);
    }

    return application;
}

function convertIntermediateToCandidate(candidate: IntermediateCandidate): JingleIceUdpCandidate {
    return {
        component: candidate.component,
        foundation: candidate.foundation,
        generation: undefined,
        id: undefined,
        ip: candidate.ip,
        network: undefined,
        port: candidate.port,
        priority: candidate.priority,
        protocol: candidate.protocol,
        relatedAddress: candidate.relatedAddress,
        relatedPort: candidate.relatedPort,
        tcpType: candidate.tcpType as 'active' | 'passive' | 'so',
        type: candidate.type
    };
}

export function convertIntermediateToTransport(media: IntermediateMediaDescription): JingleIceUdp {
    const ice = media.iceParameters;
    const dtls = media.dtlsParameters;

    const transport: JingleIceUdp = {
        candidates: [],
        transportType: NS_JINGLE_ICE_UDP_1
    };

    if (ice) {
        transport.usernameFragment = ice.usernameFragment;
        transport.password = ice.password;
    }

    if (dtls) {
        transport.fingerprints = dtls.fingerprints.map(fingerprint => ({
            algorithm: fingerprint.algorithm,
            setup: media.setup!,
            value: fingerprint.value
        }));
    }

    if (media.sctp) {
        transport.sctp = media.sctp;
    }

    for (const candidate of media.candidates || []) {
        transport.candidates!.push(convertIntermediateToCandidate(candidate));
    }

    return transport;
}

export function convertIntermediateToRequest(
    session: IntermediateSessionDescription,
    role: SessionRole
): Partial<Jingle> {
    return {
        contents: session.media.map<JingleContent>(media => {
            const isRTP = media.kind === 'audio' || media.kind === 'video';
            return {
                application: isRTP
                    ? convertIntermediateToApplication(media, role)
                    : {
                          applicationType: 'datachannel',
                          protocol: media.protocol
                      },
                creator: SessionRole.Initiator,
                name: media.mid,
                senders: directionToSenders(role, media.direction),
                transport: convertIntermediateToTransport(media)
            };
        }),
        groups: session.groups
            ? session.groups.map<JingleContentGroup>(group => ({
                  contents: group.mids,
                  semantics: group.semantics
              }))
            : []
    };
}

export function convertContentToIntermediate(
    content: JingleContent,
    role: SessionRole
): IntermediateMediaDescription {
    const application = (content.application! as JingleRtpDescription) || {};
    const transport = content.transport as JingleIceUdp;

    const isRTP = application && application.applicationType === NS_JINGLE_RTP_1;

    const media: IntermediateMediaDescription = {
        direction: sendersToDirection(role, content.senders),
        kind: application.media || 'application',
        mid: content.name,
        protocol: isRTP ? 'UDP/TLS/RTP/SAVPF' : 'UDP/DTLS/SCTP'
    };

    if (isRTP) {
        media.rtcpParameters = {
            mux: application.rtcpMux,
            reducedSize: application.rtcpReducedSize
        };

        if (application.sources && application.sources.length) {
            const source = application.sources[0];
            media.rtcpParameters.ssrc = parseInt(source.ssrc, 10);
            if (source.parameters) {
                media.rtcpParameters.cname = source.parameters.cname;
            }
        }

        media.rtpParameters = {
            codecs: [],
            fecMechanisms: [],
            headerExtensions: []
        };

        if (application.streams) {
            media.streams = [];
            for (const stream of application.streams) {
                media.streams.push({
                    stream: stream.id,
                    track: stream.track!
                });
            }
        }

        if (application.ssrc) {
            media.rtpEncodingParameters = [
                {
                    ssrc: parseInt(application.ssrc, 10)
                }
            ];

            if (application.sourceGroups && application.sourceGroups.length) {
                const group = application.sourceGroups[0];
                media.rtpEncodingParameters[0].rtx = {
                    // TODO: actually look for a FID one with matching ssrc
                    ssrc: parseInt(group.sources[1], 10)
                };
            }
        }

        for (const payload of application.codecs || []) {
            const parameters: SDP.SDPCodecAdditionalParameters = payload.parameters || {};

            const rtcpFeedback: SDP.SDPFeedbackParameter[] = [];
            for (const fb of payload.rtcpFeedback || []) {
                rtcpFeedback.push({
                    parameter: fb.parameter!,
                    type: fb.type
                });
            }

            media.rtpParameters.codecs.push({
                channels: payload.channels!,
                clockRate: payload.clockRate!,
                name: payload.name!,
                numChannels: payload.channels!,
                parameters,
                payloadType: parseInt(payload.id, 10),
                rtcpFeedback
            });
        }

        for (const ext of application.headerExtensions || []) {
            media.rtpParameters.headerExtensions.push({
                direction:
                    ext.senders && ext.senders !== 'both'
                        ? sendersToDirection(role, ext.senders)
                        : undefined,
                id: ext.id,
                uri: ext.uri
            });
        }
    }

    if (transport) {
        if (transport.usernameFragment && transport.password) {
            media.iceParameters = {
                password: transport.password,
                usernameFragment: transport.usernameFragment
            };
        }

        if (transport.fingerprints && transport.fingerprints.length) {
            media.dtlsParameters = {
                fingerprints: [],
                role: 'auto'
            };

            for (const fingerprint of transport.fingerprints) {
                media.dtlsParameters.fingerprints.push({
                    algorithm: fingerprint.algorithm!,
                    value: fingerprint.value!
                });
            }

            if (transport.sctp) {
                media.sctp = transport.sctp;
            }

            media.setup = transport.fingerprints[0].setup;
        }
    }

    return media;
}

export function convertRequestToIntermediate(
    jingle: Jingle,
    role: SessionRole
): IntermediateSessionDescription {
    const session: IntermediateSessionDescription = {
        groups: [],
        media: [],
        sessionId: jingle.sid
    };

    for (const group of jingle.groups || []) {
        session.groups!.push({
            mids: group.contents,
            semantics: group.semantics
        });
    }

    for (const content of jingle.contents || []) {
        session.media!.push(convertContentToIntermediate(content, role));
    }

    return session;
}

export function convertIntermediateToTransportInfo(
    mid: string,
    candidate: IntermediateCandidate
): Partial<Jingle> {
    return {
        contents: [
            {
                creator: SessionRole.Initiator,
                name: mid,
                transport: {
                    candidates: [convertIntermediateToCandidate(candidate)],
                    transportType: NS_JINGLE_ICE_UDP_1,
                    usernameFragment: candidate.usernameFragment || undefined
                } as JingleIceUdp
            }
        ]
    };
}
