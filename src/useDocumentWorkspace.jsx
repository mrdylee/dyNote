import {useCallback, useRef, useState} from 'react';
import {workspaceAction} from '../core/document-workspace.mjs';
export default function useDocumentWorkspace() {
  const [state,setState] = useState(() => workspaceAction(null,{type:'reset'}));
  const current = useRef(state);
  const dispatch = useCallback(action => {
    current.current = workspaceAction(current.current,action);
    setState(current.current);
  },[]);
  const setActive = useCallback(path => dispatch({type:'open',path}),[dispatch]);
  const setMode = useCallback(mode => dispatch({type:'mode',mode}),[dispatch]);
  return {...state, mode:state.modes[state.active] ?? 'read', setActive, setMode, dispatch};
}
