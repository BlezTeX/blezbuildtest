Banana Empire v0.1.2 LAN

What changed:
- Removed the dependency install step that could get stuck.
- start.bat now runs a pure Node.js LAN server directly.
- Three.js loads from CDN in the browser.
- Player data is saved by name in data/save.json.
- World owned tile data is saved in data/save.json.

How to run:
1. Extract the ZIP.
2. Run start.bat.
3. Open http://localhost:5173 on the host PC.
4. On another device on the same LAN, open the LAN address shown in the server window.

Note:
You still need Node.js installed, but you do not need to run npm install.
