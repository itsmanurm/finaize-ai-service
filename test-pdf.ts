
import { convertPdfPageToImage } from './src/utils/pdf-converter';
import * as fs from 'fs';
import * as path from 'path';

async function testConversion() {
    try {
        console.log('Starting PDF conversion test...');

        // Create a minimal valid PDF base64 (Hello World)
        // This is a minimal PDF header/body/trailer
        const minimalPdfBase64 = "JVBERi0xLjcKCjEgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmogCjw8CiAgL1R5cGUgL1BhZ2VzCiAgL01lZGlhQm94IFsgMCAwIDIwMCAyMDAgXQogIC9Db3VudCAxCiAgL0tpZHMgWyAzIDAgUiBdCj4+CmVuZG9YmoKCjMgMCBvYmogCjw8CiAgL1R5cGUgL1BhZ2WwCiAgL1BhcmVudCAyIDAgUgogIC9SZXNvdXJjZXMgPDwKICAgIC9Gb250IDw8CiAgICAgIC9GMSA0IDAgUgogICAgPj4KICA+PgogIC9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKCjQgMCBvYmogCjw8CiAgL1R5cGUgL1ZvbnQKICAvU3VidHlwZSAvVHlwZTEKICAvQmFzZUZvbnQgL1RpbWVzLVJvbWFuCj4+CmVuZG9YmoKCjUgMCBvYmogCjw8IC9MZW5ndGggMjIgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiAxMCAxMCBUZCAoSGVsbG8gV29ybGQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxMCAwMDAwMCBuIAowMDAwMDAwMDYwIDAwMDAwIG4gCjAwMDAwMDAxNTcgMDAwMDAgbiAKMDAwMDAwMDI1NSAwMDAwMCBuIAowMDAwMDAwMzUyIDAwMDAwIG4gCnRyYWlsZXIKPDwKICAvU2l6ZSA2CiAgL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjQwNQolJUVPRgo=";

        const result = await convertPdfPageToImage(minimalPdfBase64, 1);

        console.log('Conversion successful!');
        console.log('Result length:', result.length);
        console.log('Result starts with:', result.substring(0, 50));

    } catch (error) {
        console.error('Conversion FAILED:', error);
    }
}

testConversion();
