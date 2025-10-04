import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Box,
  Paper,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Alert,
  LinearProgress,
  Chip
} from '@mui/material';
import { Delete as DeleteIcon, CloudUpload as CloudUploadIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';

function FileUpload() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      status: 'pending'
    }));
    setFiles(prev => [...prev, ...newFiles]);
    setError('');
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf']
    },
    multiple: true
  });

  const removeFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const uploadFiles = async () => {
    if (files.length === 0) return;

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const uploadPromises = files.map(async (fileItem) => {
        const formData = new FormData();
        formData.append('file', fileItem.file);

        const response = await authService.api.post('/files/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setUploadProgress(prev => ({
              ...prev,
              [fileItem.id]: percentCompleted
            }));
          }
        });

        return { ...fileItem, ...response.data };
      });

      await Promise.all(uploadPromises);

      setSuccess(`Successfully uploaded ${files.length} file(s)`);
      setFiles([]);
      setUploadProgress({});

      // Redirect to dashboard after a delay
      setTimeout(() => {
        navigate('/');
      }, 2000);

    } catch (error) {
      setError(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const getFileTypeLabel = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['xlsx', 'xls'].includes(ext)) return 'Excel';
    if (ext === 'csv') return 'CSV';
    if (ext === 'pdf') return 'PDF';
    return 'Unknown';
  };

  const getFileTypeColor = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (['xlsx', 'xls'].includes(ext)) return 'primary';
    if (ext === 'csv') return 'secondary';
    if (ext === 'pdf') return 'warning';
    return 'default';
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Upload Files
      </Typography>

      <Typography variant="body1" color="textSecondary" gutterBottom>
        Upload your Fuerza Movil payment files and bank transaction statements for reconciliation.
        Supported formats: Excel (.xlsx, .xls), CSV, PDF.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}

      <Paper
        {...getRootProps()}
        sx={{
          p: 3,
          mb: 3,
          border: '2px dashed',
          borderColor: isDragActive ? 'primary.main' : 'grey.300',
          backgroundColor: isDragActive ? 'action.hover' : 'background.paper',
          cursor: 'pointer',
          textAlign: 'center'
        }}
      >
        <input {...getInputProps()} />
        <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          {isDragActive ? 'Drop the files here...' : 'Drag & drop files here, or click to select'}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Supported: Excel, CSV, PDF files
        </Typography>
      </Paper>

      {files.length > 0 && (
        <Paper sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ p: 2, pb: 0 }}>
            Files to Upload ({files.length})
          </Typography>
          <List>
            {files.map((fileItem) => (
              <ListItem key={fileItem.id}>
                <ListItemText
                  primary={fileItem.file.name}
                  secondary={`${(fileItem.file.size / 1024 / 1024).toFixed(2)} MB`}
                />
                <Chip
                  label={getFileTypeLabel(fileItem.file.name)}
                  color={getFileTypeColor(fileItem.file.name)}
                  size="small"
                  sx={{ mr: 1 }}
                />
                {uploadProgress[fileItem.id] && (
                  <Box sx={{ width: 100, mr: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={uploadProgress[fileItem.id]}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>
                )}
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    onClick={() => removeFile(fileItem.id)}
                    disabled={uploading}
                  >
                    <DeleteIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Button
          variant="contained"
          onClick={uploadFiles}
          disabled={files.length === 0 || uploading}
          size="large"
        >
          {uploading ? 'Uploading...' : `Upload ${files.length} File${files.length !== 1 ? 's' : ''}`}
        </Button>
        <Button
          variant="outlined"
          onClick={() => navigate('/')}
          disabled={uploading}
        >
          Cancel
        </Button>
      </Box>
    </Box>
  );
}

export default FileUpload;