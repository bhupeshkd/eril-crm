// Tiny UDP DNS server for tests: answers TXT and CNAME queries from an in-memory map, NXDOMAIN otherwise.
// const dns = await startFakeDns(5353); dns.records.set('_x.example.com', { txt: ['hello'] }); … await dns.close();
import dgram from 'dgram';

const TYPE = { A: 1, CNAME: 5, TXT: 16 };

function readName(buf, offset) {
  const labels = [];
  let o = offset;
  while (buf[o] !== 0) {
    const len = buf[o];
    labels.push(buf.subarray(o + 1, o + 1 + len).toString('latin1'));
    o += 1 + len;
  }
  return { name: labels.join('.').toLowerCase(), end: o + 1 };
}
function encodeName(name) {
  return Buffer.concat([...name.replace(/\.$/, '').split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'latin1')])), Buffer.from([0])]);
}
function answer(type, rdata) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(0xc00c, 0); // pointer to the question name
  h.writeUInt16BE(type, 2);
  h.writeUInt16BE(1, 4); // IN
  h.writeUInt32BE(30, 6); // TTL
  h.writeUInt16BE(rdata.length, 10);
  return Buffer.concat([h, rdata]);
}

export async function startFakeDns(port = 5353) {
  const records = new Map(); // name → { txt?: string[] | string[][], cname?: string }
  const queries = [];
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    const id = msg.readUInt16BE(0);
    const { name, end } = readName(msg, 12);
    const qtype = msg.readUInt16BE(end);
    queries.push({ name, qtype });
    const question = msg.subarray(12, end + 4);
    const rec = records.get(name);
    const answers = [];
    if (rec?.txt && qtype === TYPE.TXT) {
      for (const t of rec.txt) {
        const chunks = (Array.isArray(t) ? t : [t]).map((c) => Buffer.from(c, 'utf8'));
        answers.push(answer(TYPE.TXT, Buffer.concat(chunks.map((c) => Buffer.concat([Buffer.from([c.length]), c])))));
      }
    }
    if (rec?.cname && (qtype === TYPE.CNAME || qtype === TYPE.A)) answers.push(answer(TYPE.CNAME, encodeName(rec.cname)));
    const header = Buffer.alloc(12);
    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(rec ? 0x8180 : 0x8183, 2); // response, RD+RA; NXDOMAIN when the name is unknown
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(answers.length, 6);
    sock.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address);
  });
  await new Promise((resolve, reject) => { sock.once('error', reject); sock.bind(port, '127.0.0.1', resolve); });
  return { records, queries, close: () => new Promise((r) => sock.close(r)) };
}
