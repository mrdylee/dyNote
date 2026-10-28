# Third-party source notices

## ESS LINK viewer and Three.js

`src/ess/` and `public/ess/ess-container.glb` reuse the user's ESS viewer/model
from `mrdylee/260907_unity_link` revision
`86a11015d74e100e90c9e1aa7d4a22bb927b3e50`. The original project is preserved.
Dynote adds frame isolation, container/device note events, transparent rendering,
startup/context failure handling and embedded layout adjustments. The GLB bytes
are unchanged. Model dimensions, internal wiring and diagnostic data remain
illustrative; this is not measured CAD or a device controller. Referenced product
names and designs retain their respective owners' rights.

Three.js 0.186.0 is MIT licensed. Copyright © 2010–2026 three.js authors.
Its full license is retained in `licenses/three.txt` and the installed package.
No Unity runtime or Blender executable is redistributed.

## open-obsidian search index

`core/searchIndex.mjs` is derived from `src/core/searchIndex.ts` at https://github.com/JingHao-Leon/open-obsidian/commit/d6601440e1cd3dc049c6f81cb48903e0df61d047. TypeScript types were removed with the TypeScript compiler. Search integration and Dynote tests are separate changes.

MIT License

Copyright (c) 2026 open-obsidian contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Other dependencies retain their licenses in their installed packages. Obsidian proprietary code and assets are not included.

## GitHub Copilot integration

`@github/copilot-sdk` 1.0.23 and its matching platform runtime (Copilot 1.0.100)
are installed dependencies, published by GitHub under the MIT license. The SDK
license is retained in `licenses/copilot-sdk/LICENSE`; dependency licenses in
the installed packages remain with the application.
Source and documentation: https://github.com/github/copilot-sdk.
Use of GitHub's hosted Copilot service requires the user's own authorized
account and is subject to its plan and service terms. No Obsidian code is used
for this integration.

## Canvas and Bases (v0.3.0)

- React Flow (`@xyflow/react` 12.12.0), https://github.com/xyflow/xyflow — MIT, Copyright (c) 2019-2025 webkid GmbH. Used as an installed UI library, with its packaged LICENSE retained.
- `obsidian-bases-expression` 0.3.0-rc.4, https://github.com/callumalpass/obsidian-bases-expression — MIT, Copyright (c) 2026 Callum Alpass. Used as an installed headless expression library. Reviewed source commit: `1af9c81d8648407e56f7889cd78e7c02b4c258eb`. Its packaged LICENSE and Moment dependency license are retained. The Obsidian-specific builder/oracle scripts are not executed by Dynote.
- JSON Canvas 1.0, https://github.com/obsidianmd/jsoncanvas — MIT, Copyright (c) 2024 Obsidian.md. The public data format informed Dynote's independent format adapter. The Obsidian Canvas editor implementation is not included.

The MIT permission and warranty terms reproduced above apply to the respective MIT works with their own copyright notices. Only explicitly documented original-plugin versions and workflows are tested; no general Obsidian API compatibility or endorsement is implied. User-imported plugin programs are not bundled with Dynote.

## Graph engine (v0.3.0)

- PixiJS 8.22.0, https://github.com/pixijs/pixijs — MIT, Copyright (c) 2013-2023 Mathew Groves, Chad Engler. Its installed LICENSE is retained in the application package.
- AssemblyScript 0.28.20, https://github.com/AssemblyScript/assemblyscript — Apache-2.0. The independently authored graph kernel is compiled with its standard library/runtime. The compiler's LICENSE and NOTICE are retained in `licenses/assemblyscript/`, including in desktop packages.
- Obsidian's graph WASM, extracted JavaScript and visual assets are not included.

## Native PDF editing

`pdf-lib` 1.17.1 is an MIT-licensed dependency from [Hopding/pdf-lib](https://github.com/Hopding/pdf-lib). Copyright (c) 2019 Andrew Dillon. Its original license is retained in the installed `node_modules/pdf-lib/LICENSE.md` and packaged dependency. Dynote uses its own annotation workflow; no PDF++ program code is copied into the product. Official API references: [PDFDocument](https://pdf-lib.js.org/docs/api/classes/pdfdocument), [PDFPage](https://pdf-lib.js.org/docs/api/classes/pdfpage).
