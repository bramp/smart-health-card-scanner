"use strict";

import base64url from 'base64url';
import pako from 'pako';
import { blah } from 'pretty-print-json'; // Wierd bug https://github.com/center-key/pretty-print-json/issues/53
import QrScanner from 'qr-scanner';
import { KJUR, KEYUTIL } from 'jsrsasign';


const qr = document.getElementById('qr');
const input = document.getElementById('input');

const qrScanner = new QrScanner(qr, result => {
	qrScanner.stop();
	qr.style.display = "none";

	// Display the QR code
	input.value = result;
	input_changed();
});

qrScanner.start();

const QR_NUMERIC_OFFSET = 45;

function b64(base64) {
	// TODO Add error checking.
	return JSON.parse(base64url.decode(base64));
}

function inflate_b64(base64) {
	// TODO Add error checking.
	const bytes = base64url.toBuffer(base64);
	const decompressed = pako.inflateRaw(bytes, {to: 'string'});

	return JSON.parse(decompressed);
}

function update_sig_status(text, isError = false) {
	const sigstatus = document.getElementById('sig-status');
	sigstatus.innerHTML = text;
	sigstatus.classList = isError ? "alert alert-error" : "alert alert-info";
}

function verify_signature(header, token, xhr) {
	if (xhr.status != 200) {
		update_sig_status('<i class="error">error</i>Unable to retrieve keys: ' + xhr.statusText);
		return;
	}

	let jwk = xhr.response;
	let key = null;
	for (const k of jwk.keys) {
		if (k.kid == header.kid) {
			key = KEYUTIL.getKey(k);
			break;
		}
	}
	if (key === null) {
		update_sig_status("<i class=\"icon\">error</i>Can't find signing key " + header.kid + " in key manifest");
		return
	}
	const verification = KJUR.jws.JWS.verify(token, key);
	if (verification) {
		update_sig_status('<strong><i class="icon">verified</i> VALID SIGNATURE</strong> (key id: ' + header.kid + ") from issuer " + header.iss);
		return;
	}
	update_sig_status('<strong><i class="icon">error</i> INVALID SIGNATURE</strong> (key id: ' + header.kid + ") from issuer " + header.iss);
}

// https://spec.smarthealth.cards/#encoding-chunks-as-qr-codes
function parse_code(code) {
	console.log("process: ", code);

	if (!code.startsWith('shc:/')) {
		throw 'Code does not start with shc:/';
	}

	code = code.slice(5);

	if (code.length % 2 != 0) {
		throw 'Code has a odd number of digits';
	}

	// TODO Check for 1/2 style multi-chunks.
	let token = '';

	for (let i = 1; i < code.length; i+=2) {
		const digit = parseInt(code[i - 1] + code[i]);

		token += String.fromCharCode(digit + QR_NUMERIC_OFFSET);
	}

	const parts = token.split(".");

	if (parts.length != 3) {
		throw 'Invalid JWS token expected 3 parts it has ' + parts.length;
	}

	const jws = KJUR.jws.JWS.parse(token);

	// JWS Header
	// header includes alg: "ES256"
	// header includes zip: "DEF"
	// header includes kid equal to the base64url-encoded SHA-256 JWK Thumbprint of the key (see RFC7638)
	const header = jws.headerObj;

	// JWS Payload
	// payload is minified (i.e., all optional whitespace is stripped)
	// payload is compressed with the DEFLATE (see RFC1951) algorithm before being signed (note, this should be "raw" DEFLATE compression, omitting any zlib or gz headers)
	// payload .vc.credentialSubject.fhirBundle is created:
	// 		without Resource.id elements
	// 		without Resource.meta elements (or if present, .meta.security is included and no other fields are included)
	// 		without Resource.text elements
	// 		without CodeableConcept.text elements
	// 		without Coding.display elements
	// 		with Bundle.entry.fullUrl populated with short resource-scheme URIs (e.g., {"fullUrl": "resource:0})
	// 		with Reference.reference populated with short resource-scheme URIs (e.g., {"patient": {"reference": "resource:0"}})
	let payload;

	if ('zip' in header) {
		if (header['zip'] == 'DEF') {
			// Couldn't figure out how to get a valid UInt8Array out of jws.payloadPP
			// so extract it again
			payload = inflate_b64(parts[1]);
		} else {
			throw 'Unsupported compression ' + header['zip'];
		}
	} else {
		payload = b64(parts[1]);
	}

	let signature = jws.sigHex;

	// Add iss to the header so it is passed to the handler
	header.iss = payload.iss;

	var keysReq = new XMLHttpRequest();
	keysReq.addEventListener("loadend", function () {
		verify_signature(header, token, keysReq);
	});
	keysReq.responseType = "json";
	keysReq.open("GET", payload.iss + "/.well-known/jwks.json");
	update_sig_status('<i class="icon">pending</i>Collecting keys from issuer ' + payload.iss + " ...", true);
	keysReq.send();

	return {
		'header': header,
		'payload': payload,
		'signature': signature,
	}
}


function input_changed() {
	const code = input.value;
	if (code == "") {
		return;
	}

	const error = document.getElementById('error');

	try {
		const jws = parse_code(code);

		const header = document.getElementById('header');
		header.innerHTML = prettyPrintJson.toHtml(jws.header);

		const payload = document.getElementById('payload');
		payload.innerHTML = prettyPrintJson.toHtml(jws.payload);

		const sig = document.getElementById('signature');
		sig.innerHTML = prettyPrintJson.toHtml(jws.signature);

		error.style.display = "none";

	} catch(err) {
		error.style.display = "block";
		error.innerHTML = "Error: " + err;
	}
}

if (input.addEventListener) {
	input.addEventListener('input', input_changed, false)
}

input_changed();
