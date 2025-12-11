
const path = require('path');
const fs = require('fs');

try {
    const pdfDistPath = require.resolve('pdfjs-dist');
    console.log('pdfjs-dist path:', pdfDistPath);
    console.log('dirname:', path.dirname(pdfDistPath));

    const workerPath = path.join(path.dirname(pdfDistPath), 'build/pdf.worker.min.js');
    console.log('Calculated worker path:', workerPath);
    console.log('Worker exists?', fs.existsSync(workerPath));

    // Try legacy or different path
    const altWorkerPath = path.join(path.dirname(pdfDistPath), '../build/pdf.worker.min.js');
    console.log('Alt worker path:', altWorkerPath);
    console.log('Alt Worker exists?', fs.existsSync(altWorkerPath));

} catch (e) {
    console.error('Error finding pdfjs-dist:', e);
}

try {
    const canvas = require('canvas');
    console.log('Canvas loaded successfully');
} catch (e) {
    console.error('Error loading canvas:', e);
}
