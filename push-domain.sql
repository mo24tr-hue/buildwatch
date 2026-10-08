create or replace function public.send_push_on_notification()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'https://buildwatchapp.app/api/send-push',
    body := jsonb_build_object(
      'record', jsonb_build_object(
        'user_id', new.user_id,
        'title', new.title,
        'body', new.body,
        'project_id', new.project_id
      )
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', 'bw-push-8f3c1a9e4d27'
    )
  );
  return new;
end;
$$;
