import * as MicroblinkSDK from '@microblink/blinkid-in-browser-sdk'

const loadingScreen = document.getElementById( "loadingScreen" ) as HTMLDivElement;
const loadProgress  = document.getElementById( 'loadProgress' ) as HTMLProgressElement;

// first check if browser is supported
if ( !MicroblinkSDK.isBrowserSupported() )
{
    loadingScreen.innerHTML = "<h1>Your browser is not supported by this SDK! <h1/>";
}
else
{
    // create a load settings, defining the license key and name of the WebAssembly module
    const loadSettings = new MicroblinkSDK.WasmSDKLoadSettings( getLicenseKey() );
    // in order to provide better UX, display progress bar while loading the SDK
    loadSettings.loadProgressCallback = ( progress: number ) =>
    {
        loadProgress.value = progress;
    }

    // asynchronously load and compile the WebAssembly module.
    MicroblinkSDK.loadWasmModule( loadSettings ).then
    (
        // function called when WebAssembly module gets ready
        ( wasmSDK: MicroblinkSDK.WasmSDK ) =>
        {
            console.log( "WASM loaded successfully!" );

            // hide loading screen and display scan button
            loadingScreen.hidden = true;
            document.getElementById( 'btnStart' )!.hidden = false;

            // create an instance of MyApp and attach it to global window object
            const app = new MyApp( wasmSDK );

            // attach the app to the window object, so that it will be accessible from HTML events
            ( window as any ).app = app;
        },
        // function called when there is an error in loading the WebAssembly module
        ( reason: any ) =>
        {
            console.error( "Failed to load WASM! Reason: " + reason );
            alert( "Failed to load WASM! Reason: " + reason );
            loadingScreen.innerHTML = "<h1>Failed to load WASM! Reason: " + reason + "</h1>";
        }
    );
}

class MyApp
{
    // reference to Wasm SDK
    private wasmSDK: MicroblinkSDK.WasmSDK;

    // canvas on which metadata will be drawn
    private detectionResult: HTMLCanvasElement;
    // HTML video element displaying camera preview
    private cameraFeed: HTMLVideoElement;
    // cached 2D rendering context for detectionResult canvas
    private drawContext: CanvasRenderingContext2D;

    constructor( sdk: MicroblinkSDK.WasmSDK )
    {
        this.wasmSDK = sdk;
        this.detectionResult = document.getElementById( 'cameraFeedback' ) as HTMLCanvasElement;
        this.cameraFeed = document.getElementById( 'cameraFeed' ) as HTMLVideoElement;
        this.drawContext = this.detectionResult.getContext( '2d' )!;
    }

    // this method gets called when user clicks the "Start scanning" button
    async startScanning()
    {
        // 1. create a recognizer object, which will be used to recognize the stream of images
        // In this example, we create a MrtdRecognizer, which knows how to scan Machine Readable Zone
        // from various ID documents.
        const mrtdRecognizer = await MicroblinkSDK.createMrtdRecognizer( this.wasmSDK );

        // we will also create IdBarcodeRecognizer, which knows how to scan barcodes from various
        // ID documents
        const idBarcodeRecognizer = await MicroblinkSDK.createIdBarcodeRecognizer( this.wasmSDK );

        // 2. (optionally) create a callbacks object that will receive recognition events, such as detected object location etc.
        const callbacks: MicroblinkSDK.MetadataCallbacks = {
            onQuadDetection: ( quad: MicroblinkSDK.DisplayableQuad ) => {
                this.drawQuad( quad );
            }
        }

        // 3. create a RecognizerRunner object, which orchestrates the recognition with one or more recognizer objects
        const recognizerRunner = await MicroblinkSDK.createRecognizerRunner(
            this.wasmSDK,                               // Wasm SDK to use
            [ mrtdRecognizer, idBarcodeRecognizer ],    // list of recognizer objects that will be associated with created RecognizerRunner object
            false,                                      // (optional) should recognition pipeline stop as soon as first recognizer in chain finished recognition
            callbacks                                   // (optional) callbacks object that will receive recognition events
        );

        // 4. create a VideoRecognizer object and attach it to HTMLVideoElement that will be used for displaying the camera feed
        const videoRecognizer = await MicroblinkSDK.VideoRecognizer.createVideoRecognizerFromCameraStream( this.cameraFeed, recognizerRunner );

        // hide button and unhide display message
        document.getElementById( 'btnStart' )!.hidden = true;
        document.getElementById( 'cameraMessage' )!.hidden = false;

        // 5. start the recognition and await for the results
        const processResult = await videoRecognizer.recognize();

        // 6. if recognition was successful, obtain the results and display them
        if ( processResult != MicroblinkSDK.RecognizerResultState.Empty )
        {
            let alertMessage = '';

            const mrtdResult = await mrtdRecognizer.getResult();
            if ( mrtdResult.state != MicroblinkSDK.RecognizerResultState.Empty )
            {
                console.log( mrtdResult );
                alertMessage += "Hello, " + mrtdResult.mrzResult.secondaryID + ' ' + mrtdResult.mrzResult.primaryID + '! You were born on ' + mrtdResult.mrzResult.dateOfBirth.year + '-' + mrtdResult.mrzResult.dateOfBirth.month + '-' + mrtdResult.mrzResult.dateOfBirth.day + '!\n';
            }

            const idBarcodeResult = await idBarcodeRecognizer.getResult();
            if ( idBarcodeResult.state != MicroblinkSDK.RecognizerResultState.Empty )
            {
                console.log( idBarcodeResult );
                alertMessage += "Hello, " + idBarcodeResult.firstName + ' ' + idBarcodeResult.lastName + '! You were born on ' + idBarcodeResult.dateOfBirth.year + '-' + idBarcodeResult.dateOfBirth.month + '-' + idBarcodeResult.dateOfBirth.day + '!\n';
            }

            if ( alertMessage.length != 0 )
            {
                alert( alertMessage );
            }
        }

        // 7. release all resources allocated on the WebAssembly heap and associated with camera stream

        // release browser resources associated with the camera stream
        videoRecognizer.releaseVideoFeed();
        // release memory on WebAssembly heap used by the RecognizerRunner
        recognizerRunner.delete();
        // release memory on WebAssembly heap used by the recognizers
        mrtdRecognizer.delete();
        idBarcodeRecognizer.delete();

        // hide message and show the scan button again
        document.getElementById( 'btnStart' )!.hidden = false;
        document.getElementById( 'cameraMessage' )!.hidden = true;

        // clear any leftovers drawn to canvas
        this.clearDrawCanvas();
    }

    // utility functions for drawing detected quadrilateral onto canvas
    private drawQuad( quad: MicroblinkSDK.DisplayableQuad )
    {
        this.clearDrawCanvas();
        this.setupColor( quad );

        const ctx = this.drawContext;
        this.applyTransform( ctx, quad.transformMatrix );
        ctx.beginPath();
        ctx.moveTo( quad.topLeft    .x, quad.topLeft    .y );
        ctx.lineTo( quad.topRight   .x, quad.topRight   .y );
        ctx.lineTo( quad.bottomRight.x, quad.bottomRight.y );
        ctx.lineTo( quad.bottomLeft .x, quad.bottomLeft .y );
        ctx.closePath();
        ctx.stroke();
    }

    // this function will make sure that coordinate system associated with detectionResult canvas
    // will match the coordinate system of the image being recognized
    private applyTransform( ctx: CanvasRenderingContext2D, transformMatrix: Float32Array )
    {
        // TODO: optimization: this can be calculated once every time camera is started and browser video is resized
        // convert point from coordinates in video into coordinates in canvas
        const canvasAR = this.detectionResult.width / this.detectionResult.height;
        const videoAR  = this.cameraFeed.videoWidth / this.cameraFeed.videoHeight;

        let xOffset = 0;
        let yOffset = 0;
        let scaledVideoHeight = 0
        let scaledVideoWidth  = 0

        if ( canvasAR > videoAR ) // pillarboxing: https://en.wikipedia.org/wiki/Pillarbox
        {
            scaledVideoHeight = this.detectionResult.height;
            scaledVideoWidth = videoAR * scaledVideoHeight;
            xOffset = ( this.detectionResult.width - scaledVideoWidth ) / 2.0;
        }
        else                      // letterboxing: https://en.wikipedia.org/wiki/Letterboxing_(filming)
        {
            scaledVideoWidth = this.detectionResult.width;
            scaledVideoHeight = scaledVideoWidth / videoAR;
            yOffset = ( this.detectionResult.height - scaledVideoHeight ) / 2.0;
        }

        // first transform canvas for offset of video preview within the HTML video element (i.e. correct letterboxing or pillarboxing)
        ctx.translate( xOffset, yOffset );
        // second, scale the canvas to fit the scaled video
        ctx.scale( scaledVideoWidth / this.cameraFeed.videoWidth, scaledVideoHeight / this.cameraFeed.videoHeight );

        // finally, apply transformation from image coordinate system to
        // https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setTransform
        ctx.transform( transformMatrix[ 0 ], transformMatrix[ 3 ], transformMatrix[ 1 ], transformMatrix[ 4 ], transformMatrix[ 2 ], transformMatrix[ 5 ] );
    }

    private clearDrawCanvas()
    {
        // TODO: optimization: update this only on resize event
        this.detectionResult.width = this.detectionResult.clientWidth;
        this.detectionResult.height = this.detectionResult.clientHeight;

        this.drawContext.clearRect( 0, 0, this.detectionResult.width, this.detectionResult.height );
    }

    private setupColor( displayable: MicroblinkSDK.Displayable )
    {
        const ctx = this.drawContext;

        let color = '#FFFF00FF' // yellow
        // determine color based on detection status
        if      ( displayable.detectionStatus == MicroblinkSDK.DetectionStatus.Fail    ) color = '#FF0000FF'; // red
        else if ( displayable.detectionStatus == MicroblinkSDK.DetectionStatus.Success ) color = '#00FF00FF'; // green

        ctx.fillStyle   = color
        ctx.strokeStyle = color
        ctx.lineWidth = 5;
    }
}

// a utility function for obtaining license key for both localhost and live demo on Github
function getLicenseKey()
{
    if ( window.location.hostname == 'localhost' )
        // valid until: 2020-08-30
        return "sRwAAAYJbG9jYWxob3N0r/lOPig/w35CpJnWLiw/ZJYiDFZwYqK/kA1cRcCN5ct/CCFbjudXj+A54krF7iA0qaxxnJ27Cut6gsMoAYGPOD2RYxPUstV1D+XQi45wMHn2Xi0V0LIO5nB3dWH/I+1nLUfeLCkcwxLgcLq8I8VzCsfQ2nTgNmQ4Aq/F6GjP8Hy1lXAmZdgT+uONk9FYuPPlzAUGQmIQdWnfnPHm/wwpQR2CK7H38ZEFzOi4WF1XDbMwNCeb2Zz6NzR8Xa9MyR8opPRAVAh06XZ2"
    else if ( window.location.hostname == 'blinkid.github.io' )
        return "sRwAAAYRYmxpbmtpZC5naXRodWIuaW+qBF9hW4YlTvZbRuaFVwbiD8KZM6KyFj+Gxuno8ppVrH5oPsVMXBqdigowDAY+ZokUY/jc2Wd1nrpyFP39P9e+xwhUr4CeoPrN/g4n277HKc0MyWB2FT3x8K2+zRo0XPjQxaAaD6x3aYPEgbjBO5KL0Prr6dGZLfm5rci13gQE5xBXZ++UeDzz00RM4+Oj/i6gFW8E+n7QCTmHFBaa//QmDdT2Jr9G+svdUFemdOd6wCCPvY7Gol/x5oXDz4aUSMOksnHFdCrP//8="
    else
        throw new Error( 'No license key for ' + window.location.hostname );
}