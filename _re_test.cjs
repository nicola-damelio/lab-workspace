const t = 'xx Wl.add("shader/Mesh.frag","#define STANDARD") yy';
const re = /\.add\(\s*"(shader\/[^"]+)"/g;
console.log('selftest', re.exec(t));
