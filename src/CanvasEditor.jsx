import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  NodeResizer,
  ConnectionMode,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { parseCanvas } from "../core/canvas.mjs";
import { attachmentUrl } from "../core/knowledge.mjs";

const palette = [
  "#ffffff",
  "#e57373",
  "#efb366",
  "#e2cb64",
  "#7cba8c",
  "#71b6c9",
  "#ae91cc",
];
const color = (value) => palette[Number(value)] ?? value ?? "#ffffff";
function Card({ id, data, selected }) {
  const n = data.raw;
  return (
    <div
      className={`canvas-card canvas-${n.type}`}
      style={{
        borderColor: color(n.color),
        backgroundColor:
          n.type === "group"
            ? `${color(n.color) === "#ffffff" ? "#edf1f6" : color(n.color)}66`
            : "#fff",
      }}
    >
      <NodeResizer
        isVisible={selected && !data.readOnly}
        minWidth={120}
        minHeight={80}
        onResizeEnd={() => data.persist()}
      />
      {!data.readOnly &&
        Object.entries({
          top: Position.Top,
          right: Position.Right,
          bottom: Position.Bottom,
          left: Position.Left,
        }).map(([side, position]) => (
          <Handle key={side} type="source" id={side} position={position} />
        ))}
      <div className="canvas-card-heading">
        {n.type === "group"
          ? n.label || "그룹"
          : n.type === "text"
            ? "메모"
            : n.type === "file"
              ? n.file
              : "웹 링크"}
      </div>
      {n.type === "text" && (
        <textarea
          className="nodrag nowheel"
          aria-label={`메모 ${id}`}
          value={n.text}
          readOnly={data.readOnly}
          onChange={(e) => data.patch(id, { text: e.target.value })}
        />
      )}
      {n.type === "file" && (
        <div className="canvas-file-content">
          {data.image && (
            <img className="nodrag" src={data.image} alt={n.file} />
          )}
          {n.subpath && <small>문서 전체 보기 · {n.subpath}</small>}
          <button className="nodrag" onClick={() => data.open(n.file)}>
            파일 열기
          </button>
        </div>
      )}
      {n.type === "link" && (
        <button
          className="nodrag canvas-web-link"
          onClick={() => data.external(n.url)}
        >
          {n.url}
        </button>
      )}
    </div>
  );
}
const nodeTypes = { card: Card };

export default function CanvasEditor({
  document,
  files,
  attachments,
  vaultId,
  onChange,
  onOpen,
  onExternal,
  onError,
  readOnly = false,
}) {
  const parsed = useMemo(() => {
    try {
      return parseCanvas(document.content);
    } catch (e) {
      return { error: e.message, data: {} };
    }
  }, [document.content]);
  const [nodes, setNodes] = useState([]),
    [edges, setEdges] = useState([]);
  const [file, setFile] = useState("");
  const [webAddress, setWebAddress] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const current = useRef(document),
    emitted = useRef(null),
    history = useRef({ undo: [], redo: [] });
  const nodesRef = useRef(nodes),
    edgesRef = useRef(edges),
    locked = readOnly || parsed.readOnly || !!parsed.error;
  current.current = document;
  const callbacks = useRef({ onChange, locked });
  callbacks.current = { onChange, locked };
  nodesRef.current = nodes;
  edgesRef.current = edges;

  function decorated(raw) {
    return {
      id: raw.id,
      type: "card",
      position: { x: raw.x, y: raw.y },
      width: raw.width,
      height: raw.height,
      style: { width: raw.width, height: raw.height },
      zIndex: raw.type === "group" ? -1 : 0,
      data: {
        raw,
        readOnly: locked,
        patch,
        persist: () => commit(nodesRef.current, edgesRef.current),
        open: onOpen,
        external: onExternal,
        image:
          raw.type === "file" && /\.(png|jpe?g|gif|webp)$/i.test(raw.file)
            ? attachmentUrl(raw.file, "", attachments, vaultId)
            : null,
      },
    };
  }
  function load(data) {
    const selectedNodes = new Set(
      nodesRef.current.filter((n) => n.selected).map((n) => n.id),
    );
    const selectedEdges = new Set(
      edgesRef.current.filter((e) => e.selected).map((e) => e.id),
    );
    const nextNodes = (data.nodes ?? []).map((n) => ({
      ...decorated(n),
      selected: selectedNodes.has(n.id),
    }));
    const nextEdges = (data.edges ?? []).map((e) => ({
      id: e.id,
      source: e.fromNode,
      target: e.toNode,
      sourceHandle: e.fromSide ?? "right",
      targetHandle: e.toSide ?? "left",
      label: e.label,
      style: { stroke: e.color ? color(e.color) : "#9aa5b5" },
      markerStart:
        e.fromEnd === "arrow" ? { type: MarkerType.ArrowClosed } : undefined,
      markerEnd:
        e.toEnd === "none" ? undefined : { type: MarkerType.ArrowClosed },
      data: { raw: e },
      selected: selectedEdges.has(e.id),
    }));
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }
  useEffect(() => {
    if (document.content !== emitted.current) load(parsed.data);
  }, [document.content]);
  useEffect(() => {
    setNodes((old) =>
      old.map((n) => ({
        ...n,
        data: {
          ...n.data,
          readOnly: locked,
          open: onOpen,
          external: onExternal,
        },
      })),
    );
  }, [locked, onOpen, onExternal]);

  function publish(content, remember = true) {
    if (content === current.current.content) return;
    try {
      const value = parseCanvas(content);
      if (remember) {
        history.current.undo.push(current.current.content);
        history.current.undo = history.current.undo.slice(-30);
        history.current.redo = [];
      }
      emitted.current = content;
      load(value.data);
      callbacks.current.onChange(content);
      setHistoryVersion((v) => v + 1);
    } catch (e) {
      onError(e.message);
    }
  }
  function commit(nextNodes, nextEdges) {
    if (callbacks.current.locked) return;
    const data = parseCanvas(current.current.content).data;
    const ids = new Set(nextNodes.map((n) => n.id));
    publish(
      JSON.stringify(
        {
          ...data,
          nodes: nextNodes.map((n) => ({
            ...n.data.raw,
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
            width: Math.round(n.width ?? n.measured?.width ?? n.data.raw.width),
            height: Math.round(
              n.height ?? n.measured?.height ?? n.data.raw.height,
            ),
          })),
          edges: nextEdges
            .filter((e) => ids.has(e.source) && ids.has(e.target))
            .map((e) => ({
              ...e.data.raw,
              fromNode: e.source,
              toNode: e.target,
              fromSide: e.sourceHandle,
              toSide: e.targetHandle,
            })),
        },
        null,
        2,
      ) + "\n",
    );
  }
  function patch(id, values) {
    commit(
      nodesRef.current.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, raw: { ...n.data.raw, ...values } } }
          : n,
      ),
      edgesRef.current,
    );
  }
  function add(type) {
    if (locked || (type === "file" && !file)) return;
    let extra =
      type === "text"
        ? { text: "새 메모" }
        : type === "group"
          ? { label: "새 그룹", color: "5" }
          : { file };
    if (type === "link") {
      const url = webAddress.trim();
      try {
        if (!["https:", "http:"].includes(new URL(url).protocol))
          throw new Error();
      } catch {
        onError("올바른 웹 주소를 입력해 주세요.");
        return;
      }
      extra = { url };
    }
    const offset = nodesRef.current.length * 25;
    const raw = {
      id: crypto.randomUUID(),
      type,
      x: offset,
      y: offset,
      width: type === "group" ? 650 : 300,
      height: type === "group" ? 450 : 210,
      ...extra,
    };
    commit([...nodesRef.current, decorated(raw)], edgesRef.current);
  }
  function undo(redo = false) {
    if (locked) return;
    const from = redo ? history.current.redo : history.current.undo;
    const to = redo ? history.current.undo : history.current.redo;
    if (!from.length) return;
    to.push(current.current.content);
    publish(from.pop(), false);
  }
  function removeSelected() {
    commit(
      nodesRef.current.filter((n) => !n.selected),
      edgesRef.current.filter((e) => !e.selected),
    );
  }
  const selectedNode = nodes.find((n) => n.selected),
    selectedEdge = edges.find((e) => e.selected);
  if (parsed.error)
    return (
      <div className="structured-error" role="alert">
        Canvas를 열 수 없습니다: {parsed.error}
        <p>원본 파일은 변경하지 않았습니다.</p>
      </div>
    );
  return (
    <div
      className="canvas-editor"
      data-history={historyVersion}
      onKeyUp={(e) => {
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
          e.target.closest(".react-flow__node") &&
          !e.target.closest("textarea,input,select")
        )
          commit(nodesRef.current, edgesRef.current);
      }}
      onKeyDown={(e) => {
        if (e.target.closest("textarea,input,select")) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          undo(e.shiftKey);
        }
        if (["Delete", "Backspace"].includes(e.key)) {
          e.preventDefault();
          removeSelected();
        }
      }}
    >
      <div className="structured-toolbar">
        <strong>Canvas</strong>
        <button disabled={locked} onClick={() => add("text")}>
          메모 추가
        </button>
        <button disabled={locked} onClick={() => add("group")}>
          그룹 추가
        </button>
        <input
          aria-label="Canvas 웹 주소"
          placeholder="https://…"
          value={webAddress}
          disabled={locked}
          onChange={(e) => setWebAddress(e.target.value)}
        />
        <button
          disabled={locked || !webAddress.trim()}
          onClick={() => add("link")}
        >
          웹 링크 추가
        </button>
        <select
          aria-label="Canvas에 추가할 파일"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          disabled={locked}
        >
          <option value="">문서·첨부파일 선택</option>
          {files.map((f) => (
            <option key={f.path} value={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        <button disabled={locked || !file} onClick={() => add("file")}>
          파일 카드 추가
        </button>
        <button
          disabled={locked || !history.current.undo.length}
          onClick={() => undo()}
        >
          실행 취소
        </button>
        <button
          disabled={locked || !history.current.redo.length}
          onClick={() => undo(true)}
        >
          다시 실행
        </button>
        <button
          disabled={locked || (!selectedNode && !selectedEdge)}
          onClick={removeSelected}
        >
          선택 삭제
        </button>
      </div>
      {parsed.warnings.map((w) => (
        <p className="structured-notice" key={w}>
          {w}
        </p>
      ))}
      {selectedNode || selectedEdge ? (
        <div className="canvas-selection-tools">
          <label>
            색상{" "}
            <select
              aria-label="선택 항목 색상"
              disabled={locked}
              value={
                (selectedNode?.data.raw ?? selectedEdge?.data.raw).color ?? ""
              }
              onChange={(e) => {
                if (selectedNode)
                  patch(selectedNode.id, {
                    color: e.target.value || undefined,
                  });
                else
                  commit(
                    nodesRef.current,
                    edgesRef.current.map((edge) =>
                      edge.id === selectedEdge.id
                        ? {
                            ...edge,
                            data: {
                              raw: {
                                ...edge.data.raw,
                                color: e.target.value || undefined,
                              },
                            },
                          }
                        : edge,
                    ),
                  );
              }}
            >
              <option value="">기본</option>
              {palette.slice(1).map((c, i) => (
                <option key={c} value={String(i + 1)}>
                  {["빨강", "주황", "노랑", "초록", "파랑", "보라"][i]}
                </option>
              ))}
            </select>
          </label>
          {(selectedEdge || selectedNode?.data.raw.type === "group") && (
            <label>
              이름{" "}
              <input
                aria-label="선택 항목 이름"
                key={selectedEdge?.id ?? selectedNode.id}
                defaultValue={
                  (selectedEdge?.data.raw ?? selectedNode.data.raw).label ?? ""
                }
                disabled={locked}
                onBlur={(e) => {
                  if (selectedEdge)
                    commit(
                      nodesRef.current,
                      edgesRef.current.map((edge) =>
                        edge.id === selectedEdge.id
                          ? {
                              ...edge,
                              data: {
                                raw: {
                                  ...edge.data.raw,
                                  label: e.target.value,
                                },
                              },
                            }
                          : edge,
                      ),
                    );
                  else patch(selectedNode.id, { label: e.target.value });
                }}
              />
            </label>
          )}
        </div>
      ) : (
        <div className="canvas-selection-tools">
          <span>카드·연결선을 선택하면 색상과 이름을 바꿀 수 있습니다.</span>
        </div>
      )}
      <div className="canvas-stage">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          fitView
          minZoom={0.1}
          maxZoom={3}
          elevateNodesOnSelect={false}
          nodesDraggable={!locked}
          nodesConnectable={!locked}
          edgesReconnectable={false}
          deleteKeyCode={null}
          onNodesChange={(changes) =>
            setNodes((old) => {
              const next = applyNodeChanges(changes, old);
              nodesRef.current = next;
              return next;
            })
          }
          onEdgesChange={(changes) =>
            setEdges((old) => {
              const next = applyEdgeChanges(changes, old);
              edgesRef.current = next;
              return next;
            })
          }
          onNodeDragStop={(_e, moved) => {
            let next = nodesRef.current;
            if (moved.data.raw.type === "group") {
              const raw = moved.data.raw,
                dx = moved.position.x - raw.x,
                dy = moved.position.y - raw.y;
              next = next.map((n) =>
                n.id !== moved.id &&
                n.position.x >= raw.x &&
                n.position.y >= raw.y &&
                n.position.x + n.width <= raw.x + raw.width &&
                n.position.y + n.height <= raw.y + raw.height
                  ? {
                      ...n,
                      position: { x: n.position.x + dx, y: n.position.y + dy },
                    }
                  : n,
              );
            }
            commit(next, edgesRef.current);
          }}
          onConnect={(c) => {
            if (!locked) {
              const raw = {
                id: crypto.randomUUID(),
                fromNode: c.source,
                toNode: c.target,
              };
              commit(nodesRef.current, [
                ...edgesRef.current,
                { ...c, id: raw.id, data: { raw } },
              ]);
            }
          }}
        >
          <Background color="#e2e7ef" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="structured-footnote">
        카드를 이동·선택하고 가장자리 점을 연결하세요. 웹페이지는 외부
        브라우저로 열립니다. {nodes.length}개 카드 · {edges.length}개 연결
      </p>
    </div>
  );
}
