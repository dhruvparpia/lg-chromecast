import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

let FRIENDLY_NAME = 'Cast Bridge';
const MODEL_NAME = 'Chromecast Ultra';
const MANUFACTURER = 'Google Inc.';
const DEVICE_UUID = randomUUID();

const DIAL_PORT = 8008;

function deviceDescXml(req: IncomingMessage): string {
  const host = req.headers.host ?? `${hostname()}:${DIAL_PORT}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <URLBase>http://${host}</URLBase>
  <device>
    <deviceType>urn:dial-multiscreen-org:device:dial:1</deviceType>
    <friendlyName>${FRIENDLY_NAME}</friendlyName>
    <manufacturer>${MANUFACTURER}</manufacturer>
    <modelName>${MODEL_NAME}</modelName>
    <UDN>uuid:${DEVICE_UUID}</UDN>
    <iconList>
      <icon>
        <mimetype>image/png</mimetype>
        <width>98</width>
        <height>55</height>
        <depth>32</depth>
        <url>/setup/icon.png</url>
      </icon>
    </iconList>
    <serviceList>
      <service>
        <serviceType>urn:dial-multiscreen-org:service:dial:1</serviceType>
        <serviceId>urn:dial-multiscreen-org:serviceId:dial</serviceId>
        <controlURL>/ssdp/notfound</controlURL>
        <eventSubURL>/ssdp/notfound</eventSubURL>
        <SCPDURL>/ssdp/notfound</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

function chromecastAppXml(req: IncomingMessage): string {
  const host = req.headers.host ?? `${hostname()}:${DIAL_PORT}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<service xmlns="urn:dial-multiscreen-org:schemas:dial" dialVer="2.2">
  <name>ChromeCast</name>
  <options allowStop="true"/>
  <state>running</state>
  <activity-status>
    <description>ChromeCast</description>
  </activity-status>
  <link rel="run" href="http://${host}/apps/ChromeCast/run"/>
</service>`;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function setSsdpHeaders(res: ServerResponse, req: IncomingMessage): void {
  const host = req.headers.host ?? `${hostname()}:${DIAL_PORT}`;
  res.setHeader('Application-URL', `http://${host}/apps/`);
  res.setHeader('Application-DIAL-Version', '2.2');
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const { method, url } = req;

  setCorsHeaders(res);
  setSsdpHeaders(res, req);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === 'GET' && url === '/ssdp/device-desc.xml') {
    const xml = deviceDescXml(req);
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset="utf-8"',
      'Content-Length': Buffer.byteLength(xml),
    });
    res.end(xml);
    return;
  }

  if (method === 'GET' && url === '/apps/ChromeCast') {
    const xml = chromecastAppXml(req);
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset="utf-8"',
      'Content-Length': Buffer.byteLength(xml),
    });
    res.end(xml);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

export function startDial(port: number = DIAL_PORT, friendlyName = 'Cast Bridge'): () => void {
  FRIENDLY_NAME = friendlyName;
  const server: Server = createServer(handleRequest);

  server.listen(port, () => {
    console.log(`[dial] DIAL server listening on port ${port}`);
  });

  return () => {
    server.close();
    console.log('[dial] stopped');
  };
}
