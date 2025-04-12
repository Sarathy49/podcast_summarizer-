import { NextResponse } from 'next/server';
import { FormData } from 'formdata-node';

export async function POST(request) {
  try {
    const data = await request.json();
    
    // Create form data for the backend
    const formData = new FormData();
    formData.append('file_path', data.file_path);
    formData.append('start_time', data.start_time.toString());
    formData.append('end_time', data.end_time.toString());
    
    // Proxy the request to the backend server
    const response = await fetch('http://localhost:8000/api/trim', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      console.error(`Error trimming audio: ${response.status} ${response.statusText}`);
      return new NextResponse(null, { 
        status: response.status,
        statusText: response.statusText
      });
    }
    
    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error trimming audio:', error);
    return new NextResponse(null, { status: 500 });
  }
} 