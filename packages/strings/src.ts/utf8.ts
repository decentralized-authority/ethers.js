"use strict";

import { checkNormalize } from "@ethersproject/errors";

import { arrayify, BytesLike } from "@ethersproject/bytes";

///////////////////////////////

export enum UnicodeNormalizationForm {
    current  = "",
    NFC      = "NFC",
    NFD      = "NFD",
    NFKC     = "NFKC",
    NFKD     = "NFKD"
};

// http://stackoverflow.com/questions/13356493/decode-utf-8-with-javascript#13691499
function getUtf8CodePoints(bytes: BytesLike, ignoreErrors?: boolean): Array<number> {
    bytes = arrayify(bytes);

    let result: Array<number> = [];
    let i = 0;

    // Invalid bytes are ignored
    while(i < bytes.length) {

        let c = bytes[i++];
        // 0xxx xxxx
        if (c >> 7 === 0) {
            result.push(c);
            continue;
        }

        // Multibyte; how many bytes left for this character?
        let extraLength = null;
        let overlongMask = null;

        // 110x xxxx 10xx xxxx
        if ((c & 0xe0) === 0xc0) {
            extraLength = 1;
            overlongMask = 0x7f;

        // 1110 xxxx 10xx xxxx 10xx xxxx
        } else if ((c & 0xf0) === 0xe0) {
            extraLength = 2;
            overlongMask = 0x7ff;

        // 1111 0xxx 10xx xxxx 10xx xxxx 10xx xxxx
        } else if ((c & 0xf8) === 0xf0) {
            extraLength = 3;
            overlongMask = 0xffff;

        } else {
            if (!ignoreErrors) {
                if ((c & 0xc0) === 0x80) {
                    throw new Error("invalid utf8 byte sequence; unexpected continuation byte");
                }
                throw new Error("invalid utf8 byte sequence; invalid prefix");
            }
            continue;
        }

        // Do we have enough bytes in our data?
        if (i + extraLength > bytes.length) {
            if (!ignoreErrors) { throw new Error("invalid utf8 byte sequence; too short"); }

            // If there is an invalid unprocessed byte, skip continuation bytes
            for (; i < bytes.length; i++) {
                if (bytes[i] >> 6 !== 0x02) { break; }
            }

            continue;
        }

        // Remove the length prefix from the char
        let res = c & ((1 << (8 - extraLength - 1)) - 1);

        for (let j = 0; j < extraLength; j++) {
            let nextChar = bytes[i];

            // Invalid continuation byte
            if ((nextChar & 0xc0) != 0x80) {
                res = null;
                break;
            };

            res = (res << 6) | (nextChar & 0x3f);
            i++;
        }

        if (res === null) {
            if (!ignoreErrors) { throw new Error("invalid utf8 byte sequence; invalid continuation byte"); }
            continue;
        }

        // Check for overlong seuences (more bytes than needed)
        if (res <= overlongMask) {
            if (!ignoreErrors) { throw new Error("invalid utf8 byte sequence; overlong"); }
            continue;
        }

        // Maximum code point
        if (res > 0x10ffff) {
            if (!ignoreErrors) { throw new Error("invalid utf8 byte sequence; out-of-range"); }
            continue;
        }

        // Reserved for UTF-16 surrogate halves
        if (res >= 0xd800 && res <= 0xdfff) {
            if (!ignoreErrors) { throw new Error("invalid utf8 byte sequence; utf-16 surrogate"); }
            continue;
        }

        result.push(res);
    }

    return result;
}

// http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
export function toUtf8Bytes(str: string, form: UnicodeNormalizationForm = UnicodeNormalizationForm.current): Uint8Array {

    if (form != UnicodeNormalizationForm.current) {
        checkNormalize();
        str = str.normalize(form);
    }

    let result = [];
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i);

        if (c < 0x80) {
            result.push(c);

        } else if (c < 0x800) {
            result.push((c >> 6) | 0xc0);
            result.push((c & 0x3f) | 0x80);

        } else if ((c & 0xfc00) == 0xd800) {
            i++;
            let c2 = str.charCodeAt(i);

            if (i >= str.length || (c2 & 0xfc00) !== 0xdc00) {
                throw new Error("invalid utf-8 string");
            }

            // Surrogate Pair
            c = 0x10000 + ((c & 0x03ff) << 10) + (c2 & 0x03ff);
            result.push((c >> 18) | 0xf0);
            result.push(((c >> 12) & 0x3f) | 0x80);
            result.push(((c >> 6) & 0x3f) | 0x80);
            result.push((c & 0x3f) | 0x80);

        } else {
            result.push((c >> 12) | 0xe0);
            result.push(((c >> 6) & 0x3f) | 0x80);
            result.push((c & 0x3f) | 0x80);
        }
    }

    return arrayify(result);
};

function escapeChar(value: number) {
    let hex = ("0000" + value.toString(16));
    return "\\u" + hex.substring(hex.length - 4);
}

export function _toEscapedUtf8String(bytes: BytesLike, ignoreErrors?: boolean): string {
    return '"' + getUtf8CodePoints(bytes, ignoreErrors).map((codePoint) => {
        if (codePoint < 256) {
            switch (codePoint) {
                case 8:  return "\\b";
                case 9:  return "\\t";
                case 10: return "\\n"
                case 13: return "\\r";
                case 34: return "\\\"";
                case 92: return "\\\\";
            }

            if (codePoint >= 32 && codePoint < 127) {
                return String.fromCharCode(codePoint);
            }
        }

        if (codePoint <= 0xffff) {
            return escapeChar(codePoint);
        }

        codePoint -= 0x10000;
        return escapeChar(((codePoint >> 10) & 0x3ff) + 0xd800) + escapeChar((codePoint & 0x3ff) + 0xdc00);
    }).join("") + '"';
}

export function toUtf8String(bytes: BytesLike, ignoreErrors?: boolean): string {
    return getUtf8CodePoints(bytes, ignoreErrors).map((codePoint) => {
        if (codePoint <= 0xffff) {
            return String.fromCharCode(codePoint);
        }
        codePoint -= 0x10000;
        return String.fromCharCode(
            (((codePoint >> 10) & 0x3ff) + 0xd800),
            ((codePoint & 0x3ff) + 0xdc00)
        );
    }).join("");
}

export function toUtf8CodePoints(str: string, form: UnicodeNormalizationForm = UnicodeNormalizationForm.current): Array<number> {
    return getUtf8CodePoints(toUtf8Bytes(str, form));
}