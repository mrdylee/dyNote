import {useCallback, useRef, useState} from 'react';
import {workspaceAction} from '../core/document-workspace.mjs';
import {readSplitPosition} from './split-reading-position.mjs';

const initialMarkdownMode = key => readSplitPosition(key) ? 'split' : 'live';

export default function useDocumentWorkspace() {
  const [state,setState] = useState(() => workspaceAction(null,{type:'reset'}));
  const current = useRef(state);
  const dispatch = useCallback(action => {
    current.current = workspaceAction(current.current,action,initialMarkdownMode);
    setState(current.current);
  },[]);
  const setActive = useCallback(path => dispatch({type:'open',path}),[dispatch]);
  const setMode = useCallback(mode => dispatch({type:'mode',mode}),[dispatch]);
  return {...state, mode:state.modes[state.active] ?? 'live', setActive, setMode, dispatch};
}
