import fs from 'fs';

// jsx 파일에서 파서 함수들과 샘플 데이터를 추출하여 테스트
const code = fs.readFileSync('json-card-builder.jsx', 'utf8');

// React import 제거, 컴포넌트/테마 제거하고 파서+샘플만 추출
const evalCode = code
  .replace(/^import .*/gm, '')
  .replace(/\/\/ =+ 테마 시스템 =+[\s\S]*$/, ''); // 테마 이후 전부 제거

// 함수들을 global에 노출
const wrappedCode = `
${evalCode}

// 회귀 테스트 실행
const samples = {
  table: asciiSamples.table,
  timeline: asciiSamples.timeline,
  season: asciiSamples.season,
  spec: asciiSamples.spec,
  diagram: asciiSamples.diagram,
  sections: asciiSamples.sections,
  tree: asciiSamples.tree,
  arch: asciiSamples.arch,
  hierarchy: asciiSamples.hierarchy,
  sequence: asciiSamples.sequence,
  sequenceCtrl: asciiSamples.sequenceCtrl,
  hierarchyNested: asciiSamples.hierarchyNested,
};

let pass = 0, fail = 0;

for (const [name, ascii] of Object.entries(samples)) {
  const result = parseAsciiToJson(ascii);
  const hasTitle = !!result.title;
  const hasNodes = result.nodes && result.nodes.length > 0;
  const types = result.nodes.map(n => n.type).join(', ');
  const ok = hasTitle && hasNodes;

  if (ok) {
    pass++;
    console.log(\`  ✓ \${name.padEnd(18)} title="\${result.title.substring(0, 30)}" nodes=[\${types}]\`);
  } else {
    fail++;
    console.log(\`  ✗ \${name.padEnd(18)} title="\${result.title}" nodes=\${result.nodes.length} FAIL\`);
    console.log(\`    \${JSON.stringify(result).substring(0, 200)}\`);
  }
}

console.log(\`\\n결과: \${pass}/\${pass + fail} 통과\`);
if (fail > 0) process.exit(1);
`;

eval(wrappedCode);
