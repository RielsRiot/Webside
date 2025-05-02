const webp = require( 'webp-converter' );
const fsSync = require( 'fs' );
const fs = require( 'libfsasync' );
const path = require( 'path' );
const esbuild = require( 'esbuild' );
const css = require( 'css-minify' );
const html = require( '@minify-html/node' );

webp.grant_permission();

const buildPath = path.join( __dirname, "./../Build" );
const publicPath = path.join( __dirname, "./../Public" );

fsSync.rmSync( buildPath, { recursive: true, force: true } );

let errors = [];

function getExtension ( shard ) {
    return path.extname( shard );
}

function replaceExtension ( shard, ext ) {
    let old = path.extname( shard );
    return shard.substring( 0, shard.length - old.length ) + ext;
}

async function process ( shard ) {
    let from = path.join( publicPath, shard );
    let to = path.join( buildPath, shard );

    let stat = await fs.statAsync( from );
    if ( stat.isDirectory() ) {
        console.log( '⏳', from, '->', to );
        await fs.mkdirAsync( to );
        let list = await fs.readdirAsync( from );
        list = list.map( next => process( path.join( shard, next ) ) );
        await Promise.all( list );
        console.log( '✔️ ', from, '->', to );
        return;
    }

    let extension = getExtension( shard );
    switch ( extension ) {
        case '.png':
        case '.jpg':
            to = replaceExtension( to, '.webp' );
            console.log( '⏳', from, '->', to );
            await webp.cwebp( from, to );
            break;

        case '.js':
            console.log( '⏳', from, '->', to );
            await esbuild.build( {
                entryPoints: [from],
                outfile: to,
                minify: true
            } );
            break;

        case '.css':
            console.log( '⏳', from, '->', to );
            await fs.writeFileAsync( to, await css( await fs.readFileAsync( from ) ) );
            break;

        case '.html':
            console.log( '⏳', from, '->', to );
            await fs.writeFileAsync( to, html.minify( await fs.readFileAsync( from ), {} ) );
            break;

        default:
            errors.push( [from, '->', to].join( ' ' ) );
            await fs.copyFileAsync( from, to );
            return;
    }

    console.log( '✔️ ', from, '->', to );
}

process( '' ).then( () => {
    if ( errors.length != 0 ) {
        console.error( 'The following files could not be processed (they were copied):\n\t' + errors.join( '\n\t' ) );
    }
} );