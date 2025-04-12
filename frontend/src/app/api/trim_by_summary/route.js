import { NextResponse } from 'next/server';
import { FormData } from 'formdata-node';

export async function POST(request) {
  try {
    const data = await request.json();
    
    // Create form data for the backend
    const formData = new FormData();
    formData.append('file_path', data.file_path);
    
    // Handle summary points - could be an array or a string
    if (Array.isArray(data.summary_points)) {
      formData.append('summary_points', JSON.stringify(data.summary_points));
    } else {
      formData.append('summary_points', data.summary_points);
    }
    
    // Add padding seconds with default value if not provided
    formData.append('padding_seconds', (data.padding_seconds || 3.0).toString());
    
    // Proxy the request to the backend server
    const response = await fetch('http://localhost:8000/api/trim_by_summary', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      console.error(`Error trimming audio by summary: ${response.status} ${response.statusText}`);
      return new NextResponse(null, { 
        status: response.status,
        statusText: response.statusText
      });
    }
    
    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error trimming audio by summary:', error);
    return new NextResponse(null, { status: 500 });
  }
} 