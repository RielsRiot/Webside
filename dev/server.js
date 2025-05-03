const express = require('express');
var compression = require('compression');
const path = require('path');
const process = require('process');
const child = require('child_process');

let type = 'build';
if ( process.argv[2] == '-dev' )
    type = 'dev';

console.log( 'mode = ' + type );

if ( type == 'build' ) {
    child.execFileSync( 'node', ['./build.js'], { stdio: 'inherit' } );
}

const app = express();

app.use(compression());
app.use( express.static( path.join(__dirname, type == 'build' ? '../Build' : "../Public") ) );

app.listen( 8080, () => {
    console.log( 'running on port 8080!' );
} );
