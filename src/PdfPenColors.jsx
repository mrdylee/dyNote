const colors = [
  ['노랑', '#ffff00'],
  ['연두', '#69ed45'],
  ['하늘', '#44caff'],
  ['분홍', '#ff72ac'],
  ['주황', '#ff9e35'],
];

export default function PdfPenColors({value, onChange, disabled}) {
  return <span className="pdf-pen-colors" role="group" aria-label="형광펜 색상">
    {colors.map(([name, color]) =>
      <button key={color} type="button" title={name} aria-label={name} aria-pressed={value === color}
        disabled={disabled} style={{backgroundColor: color}} onClick={() => onChange(color)}>
        {value === color ? '✓' : ''}
      </button>)}
  </span>;
}
