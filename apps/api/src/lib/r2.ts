type PresignOptions = {
  method?: string;
  expiresIn?: number;
};

type R2BucketWithPresign = R2Bucket & {
  createPresignedUrl?: (key: string, options?: PresignOptions) => Promise<string>;
};

export async function tryCreatePresignedUrl(
  bucket: R2Bucket,
  key: string,
  options?: PresignOptions
): Promise<string | null> {
  const signer = (bucket as R2BucketWithPresign).createPresignedUrl;
  if (!signer) {
    return null;
  }
  return await signer.call(bucket, key, options);
}
