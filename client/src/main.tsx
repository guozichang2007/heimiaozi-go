import { render } from 'preact';
import { App } from './App';
import { connect } from './state/store';
import '@sabaki/shudan/css/goban.css';
import './styles.css';

connect();

render(<App />, document.getElementById('app')!);
