import React, { useEffect } from 'react';
import { useStore } from '../../store';

const Loader: React.FC = () => {
  const { setIsLoading } = useStore();

  useEffect(() => {
    // When this component mounts inside Suspense, it means the content is ready
    setIsLoading(false);
    return () => {
      // Potentially set back to true on unmount if needed
    };
  }, [setIsLoading]);

  return null;
};

export default Loader;
