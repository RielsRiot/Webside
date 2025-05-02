const webp = require( 'webp-converter' );
const fsSync = require( 'fs' );
const fs = require( 'libfsasync' );
const path = require( 'path' );
const esbuild = require( 'esbuild' );
const css = require( 'css-minify' );
const html = require( '@minify-html/node' );
const htmlParser = require( 'node-html-parser' );
const imageSize = require( 'image-size' );

webp.grant_permission();

const buildPath = path.join( __dirname, "./../Build" );
const publicPath = path.join( __dirname, "./../Public" );

let imageOriginalWidths = {};
let optimalImages = {};

function addImage ( path, width ) {
    if ( imageOriginalWidths[path] <= width )
        return false;

    if ( optimalImages[path] == undefined ) {
        optimalImages[path] = {};
    }

    optimalImages[path][width] = true;
    return true;
}

fsSync.rmSync( buildPath, { recursive: true, force: true } );

let errors = [];
let withDependencies = [];
function addDependentFile ( from, to, dependencies, build, dependencyHints ) {
    log( '🕒', from, '->', to, '['+[...dependencies, ...dependencyHints].join(', ')+']' );
    withDependencies.push( {
        from, to, dependencies, build
    } );
}

function log ( ...args ) {
    console.log( ...args.map( x => {
        if ( typeof x === 'string' ) {
            return x.replaceAll( buildPath, 'Build' ).replaceAll( publicPath, 'Public' );
        }

        return x;
    } ) );
}

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
        log( '⏳', from, '->', to );
        await fs.mkdirAsync( to );
        let list = await fs.readdirAsync( from );
        list = list.map( next => process( path.join( shard, next ) ) );
        await Promise.all( list );
        log( '✔️ ', from, '->', to );
        return;
    }

    let extension = getExtension( shard );
    switch ( extension ) {
        case '.png':
        case '.jpg': // 120w, 480w, 1080w, original
            to = replaceExtension( to, '.webp' );
            log( '⏳', from, '->', to );

            let size = imageSize.imageSize( await fs.readFileAsync( from ) );
            imageOriginalWidths[to] = size.width;
            await webp.cwebp( from, to );
            log( '✔️ ', from, '->', to );
            return;

        case '.js':
            log( '⏳', from, '->', to );
            await esbuild.build( {
                entryPoints: [from],
                outfile: to,
                minify: true
            } );
            break;

        case '.css':
            log( '⏳', from, '->', to );
            await fs.writeFileAsync( to, await css( await fs.readFileAsync( from ) ) );
            break;

        case '.html':
            let data = await fs.readFileAsync( from );
            let inner = htmlParser.parse( data );
            let deps = inner.querySelectorAll( '[inline]' );
            addDependentFile( from, to, deps.map( x => x.getAttribute('href') ), async (resolved) => {
                log( '⚒️ ', from, '->', to );
                for ( let i = 0; i < deps.length; i++ ) {
                    let name = deps[i].getAttribute( 'href' );
                    let value = resolved[name];
                    let style = htmlParser.parse('<style>'+value+'</style>');
                    deps[i].replaceWith( style );
                }

                inner.querySelectorAll( 'img' ).forEach( x => {
                    let name = x.getAttribute( 'src' );
                    if ( !x.hasAttribute('sizes') ) {
                        errors.push( `[image has no "sizes" attribute] ${name} @ ${to}` );
                        return;
                    }

                    var src = path.join( to, '..', name );
                    let sizes = x.getAttribute( 'sizes' ).split( ',' ).map( x => Array.from(x.matchAll( /\d+/g )).pop()[0] ).filter( x => addImage( src, x ) ).map( x => replaceExtension(name, `.${x}px.webp`) + ' ' + x + 'w' );
                    sizes.push( name + ' ' + imageOriginalWidths[src] + 'w' );
                    x.setAttribute( 'srcset', sizes.join(', ') );
                } );

                await fs.writeFileAsync( to, html.minify( Buffer.from(inner.toString()), {} ) );
                log( '✔️ ', from, '->', to );
            }, ['images'] );

            return;

        default:
            errors.push( ['[No compression method]', from, '->', to].join( ' ' ) );
            await fs.copyFileAsync( from, to );
            return;
    }

    log( '✔️ ', from, '->', to );
}

async function processDependencies () {
    while ( true ) {
        let anyProcessed = false;
        for ( let i = 0; i < withDependencies.length; i++ ) {
            let current = withDependencies[i];
            let allResolved = true;
            for ( let j = 0; j < current.dependencies.length; j++ ) {
                if ( !fsSync.existsSync( path.join( current.to, '..', current.dependencies[j] ) ) ) {
                    allResolved = false;
                    break;
                }
            }

            if ( allResolved ) {
                anyProcessed = true;
                withDependencies[i] = withDependencies[withDependencies.length - 1];
                withDependencies.length--;
                i--;

                let deps = {};
                for ( let j = 0; j < current.dependencies.length; j++ ) {
                    deps[current.dependencies[j]] = await fs.readFileAsync( path.join( current.to, '..', current.dependencies[j] ) );
                }

                await current.build( deps );
            }
        }

        if ( !anyProcessed )
            return;
    }
}

async function processOptimalImages () {
    var tasks = [];

    for ( let img in optimalImages ) {
        for ( let size in optimalImages[img] ) {
            let to = replaceExtension(img, '.'+size+'px.webp');
            log( '⚒️ ', img, '->', to );
            tasks.push( webp.cwebp( img, to, "-resize "+size+" 0" ).then( () => {
                log( '✔️ ', img, '->', to );
            } ) );
        }
    }

    await Promise.all( tasks );
}

process( '' ).then( async () => {
    await processDependencies();
    await processOptimalImages();

    if ( errors.length != 0 ) {
        log( 'Errors:\n\t' + errors.join( '\n\t' ) );
    }
} );