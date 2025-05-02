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

const imageSizes = [120, 240, 480, 900];
let imageOriginalWidths = {};

fsSync.rmSync( buildPath, { recursive: true, force: true } );

let errors = [];
let withDependencies = [];
function addDependentFile ( from, to, dependencies, build ) {
    withDependencies.push( {
        from, to, dependencies, build
    } );
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
        case '.jpg': // 120w, 480w, 1080w, original
            to = replaceExtension( to, '.webp' );
            console.log( '⏳', from, '->', to );

            let size = imageSize.imageSize( await fs.readFileAsync( from ) );
            imageOriginalWidths[to] = size.width;
            let tasks = [webp.cwebp( from, to )];
            imageSizes.forEach( w => {
                if ( size.width > w ) {
                    tasks.push( webp.cwebp( from, replaceExtension(to, '.'+w+'px.webp'), "-resize "+w+" 0" ) );
                }
            });

            await Promise.all( tasks );
            console.log( '✔️ ', from, '->', to );
            return;

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
            let data = await fs.readFileAsync( from );
            let inner = htmlParser.parse( data );
            let deps = inner.querySelectorAll( '[inline]' );
            addDependentFile( from, to, deps.map( x => x.getAttribute('href') ), async (resolved) => {
                console.log( '⚒️', from, '->', to );
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
                    }

                    let sizes = [];
                    imageSizes.forEach( w => {
                        let size = replaceExtension(name, '.'+w+'px.webp');
                        if ( fsSync.existsSync( path.join( to, '..', size ) ) ) {
                            sizes.push( size + ' ' + w + 'w' );
                        }
                    });

                    if ( sizes.length != 0 ) {
                        sizes.push( name + ' ' + imageOriginalWidths[path.join(to, '..', name)] + 'w' );
                        x.setAttribute( 'srcset', sizes.join( ', ' ) );
                        x.removeAttribute('src');
                    }
                } );

                await fs.writeFileAsync( to, html.minify( Buffer.from(inner.toString()), {} ) );
                console.log( '✔️ ', from, '->', to );
            } );

            return;

        default:
            errors.push( ['[No compression method]', from, '->', to].join( ' ' ) );
            await fs.copyFileAsync( from, to );
            return;
    }

    console.log( '✔️ ', from, '->', to );
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

process( '' ).then( async () => {
    await processDependencies();

    if ( errors.length != 0 ) {
        console.error( 'Errors:\n\t' + errors.join( '\n\t' ) );
    }
} );