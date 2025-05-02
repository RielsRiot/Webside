const express = require('express');
var compression = require('compression');
const path = require('path');

const app = express();

app.use(compression());
app.use( express.static( path.join(__dirname, "../Build") ) );

app.listen( 8080, () => {
    console.log( 'running on port 8080!' );
} );
