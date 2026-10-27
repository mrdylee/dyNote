export default function NavigationPanel({ title, paths, onOpen }) {
  return <section className="native-navigation" aria-label={title}>
    <h3>{title}</h3>
    {paths.length ? paths.map(path=><button key={path} title={path} onClick={()=>onOpen(path)}><strong>{path.split('/').at(-1).replace(/\.md$/i,'')}</strong><small>{path}</small></button>) : <p className="muted empty-small">아직 기록이 없습니다.</p>}
  </section>;
}
